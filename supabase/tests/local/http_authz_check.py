"""HTTP-level authorization checks against a PostgREST instance (local disposable DB only).
See README.md. Mirrors the exact request shapes the app sends (explicit public column lists).
"""
import json, hmac, hashlib, base64, urllib.request, urllib.error
import os
SECRET=os.environ.get("JWT_SECRET","super-secret-jwt-token-with-at-least-32-characters-long").encode()
BASE=os.environ.get("POSTGREST_URL","http://localhost:3999")
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub):
    h=b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); p=b64(json.dumps({"role":"authenticated","sub":sub,"aud":"authenticated"}).encode())
    return f"{h}.{p}."+b64(hmac.new(SECRET,f"{h}.{p}".encode(),hashlib.sha256).digest())
OWNER,OTHER,ADMIN="11111111-aaaa-4000-8000-000000000001","11111111-aaaa-4000-8000-000000000002","11111111-aaaa-4000-8000-000000000003"
COLS="id,slug,name,type,industry,county,city_district,website_url,logo_url,cover_image_url,description,employee_count_range,verification_status,verification_badge,created_at,updated_at,is_verified,website,logo_text,address,established_year"
def call(method,path,who=None,body=None):
    h={"Content-Type":"application/json","Prefer":"return=representation"}
    if who: h["Authorization"]="Bearer "+jwt(who)
    req=urllib.request.Request(BASE+path,method=method,headers=h,data=json.dumps(body).encode() if body is not None else None)
    try:
        r=urllib.request.urlopen(req); return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
res=[]
def check(name,cond,detail=""): res.append(cond); print(("PASS " if cond else "FAIL ")+name+(f"  [{detail[:110]}]" if not cond else ""))
s,b=call("GET","/organizations?select=*"); check("anon select=* rejected (permission denied)", s in (401,403) and "permission denied" in b.lower(), f"{s} {b}")
s,b=call("GET","/organizations?select=tax_id_number"); check("anon select=tax_id_number rejected", s in (401,403), f"{s} {b}")
s,b=call("GET","/organizations?select=contact_email,registration_number,settings"); check("anon private cols rejected", s in (401,403), f"{s} {b}")
s,b=call("GET",f"/organizations?select={COLS}"); check("anon public columns OK and no private data in body", s==200 and "TIN-SECRET" not in b and "secret@acme.test" not in b and "HTTP Org" in b, f"{s} {b}")
s,b=call("GET",f"/organizations?select={COLS}&id=eq.org-http","11111111-aaaa-4000-8000-000000000002"); check("authenticated non-member public columns OK", s==200 and "HTTP Org" in b, f"{s} {b}")
s,b=call("GET","/organizations?select=*","11111111-aaaa-4000-8000-000000000002"); check("authenticated select=* rejected", s in (401,403), f"{s} {b}")
s,b=call("GET",f"/opportunities?select=*,organizations({COLS})"); check("anon opportunities embed with public columns OK", s==200, f"{s} {b}")
s,b=call("GET","/opportunities?select=*,organizations(*)"); check("anon opportunities embed organizations(*) rejected", s in (401,403), f"{s} {b}")
s,b=call("GET","/opportunities?select=*,organizations(tax_id_number)"); check("anon embed of tax_id_number rejected", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",None,{"p_org_ids":["org-http"]}); check("anon cannot call private-fields RPC", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",OTHER,{"p_org_ids":["org-http"]}); check("non-member gets [] from private-fields RPC", s==200 and json.loads(b)==[], f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",OWNER,{"p_org_ids":["org-http"]}); check("active owner gets private fields", s==200 and json.loads(b)[0]["tax_id_number"]=="TIN-SECRET", f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",ADMIN,{"p_org_ids":["org-http"]}); check("platform admin gets private fields", s==200 and len(json.loads(b))==1, f"{s} {b}")
# privilege escalation attempts over the real REST API
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"system_role":"platform_admin"}); check("PATCH own system_role=platform_admin rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"primary_role":"platform_admin"}); check("PATCH own primary_role=platform_admin rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"email":"owner@acme.test"}); check("PATCH own email rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"account_status":"active","is_email_verified":True}); check("PATCH is_email_verified rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"full_name":"Renamed Other","primary_county":"Margibi"}); check("PATCH ordinary profile fields still works", s==200 and "Renamed Other" in b, f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"primary_role":"recruiter"}); check("PATCH self-selectable primary_role=recruiter still works", s==200, f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"verification_status":"verified"}); check("owner PATCH verification_status=verified rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"is_verified":True}); check("owner PATCH is_verified=true rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/organizations?id=eq.org-http&select={COLS}",OWNER,{"description":"updated by owner","contact_email":"new@acme.test"}); check("owner profile PATCH (app shape: select=public cols) works and returns no private data", s==200 and "updated by owner" in b and "new@acme.test" not in b, f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",OWNER,{"p_org_ids":["org-http"]}); check("owner private edit is visible through the RPC", s==200 and json.loads(b)[0]["contact_email"]=="new@acme.test", f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"description":"x"}); check("PATCH with default RETURNING * is rejected (clients must pass select=public cols)", s in (401,403), f"{s} {b}")
s,b=call("POST","/organizations",OTHER,{"id":"o-x","slug":"o-x","name":"X","type":"private_company","industry":"x","county":"Montserrado","city_district":"M","description":"d","verification_status":"verified"}); check("POST pre-verified org rejected", s in (401,403), f"{s} {b}")
print(f"\n{sum(res)}/{len(res)} passed")
import sys; sys.exit(0 if all(res) else 1)
