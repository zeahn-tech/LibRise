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
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"is_email_verified":False}); check("PATCH is_email_verified (a real change) rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"full_name":"Renamed Other","primary_county":"Margibi"}); check("PATCH ordinary profile fields still works", s==200 and "Renamed Other" in b, f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{OTHER}",OTHER,{"primary_role":"recruiter"}); check("PATCH self-selectable primary_role=recruiter still works", s==200, f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"verification_status":"verified"}); check("owner PATCH verification_status=verified rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"is_verified":True}); check("owner PATCH is_verified=true rejected", s in (401,403), f"{s} {b}")
s,b=call("PATCH",f"/organizations?id=eq.org-http&select={COLS}",OWNER,{"description":"updated by owner","contact_email":"new@acme.test"}); check("owner profile PATCH (app shape: select=public cols) works and returns no private data", s==200 and "updated by owner" in b and "new@acme.test" not in b, f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",OWNER,{"p_org_ids":["org-http"]}); check("owner private edit is visible through the RPC", s==200 and json.loads(b)[0]["contact_email"]=="new@acme.test", f"{s} {b}")
s,b=call("PATCH","/organizations?id=eq.org-http",OWNER,{"description":"x"}); check("PATCH with default RETURNING * is rejected (clients must pass select=public cols)", s in (401,403), f"{s} {b}")
s,b=call("POST","/organizations",OTHER,{"id":"o-x","slug":"o-x","name":"X","type":"private_company","industry":"x","county":"Montserrado","city_district":"M","description":"d","verification_status":"verified"}); check("POST pre-verified org rejected", s in (401,403), f"{s} {b}")
SUSP,ADM2="11111111-aaaa-4000-8000-000000000004","11111111-aaaa-4000-8000-000000000005"
# suspended account (F-16)
s,b=call("GET",f"/organizations?select={COLS}",SUSP); check("suspended: public org list is empty for the suspended session", s==200 and json.loads(b)==[], f"{s} {b}")
s,b=call("GET",f"/users?id=eq.{SUSP}&select=id,account_status",SUSP); check("suspended: can still read own users row (status display)", s==200 and len(json.loads(b))==1, f"{s} {b}")
s,b=call("PATCH",f"/users?id=eq.{SUSP}&select=id,account_status",SUSP,{"account_status":"active"}); check("suspended: cannot self-reinstate via PATCH", s in (401,403) or (s==200 and json.loads(b)==[]), f"{s} {b}")
s,b=call("POST","/rpc/create_organization_with_owner",SUSP,{"p_id":"o-susp","p_slug":"o-susp","p_name":"n","p_type":"private_company","p_industry":"x","p_county":"Montserrado","p_city_district":"M","p_description":"d","p_logo_text":None,"p_website":None,"p_contact_email":None,"p_contact_phone":None,"p_settings":None}); check("suspended: RPC create_organization_with_owner denied", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/get_organization_private_fields",SUSP,{"p_org_ids":["org-http"]}); check("suspended: private-fields RPC returns nothing", s in (401,403) or (s==200 and json.loads(b)==[]), f"{s} {b}")
s,b=call("POST","/rpc/create_organization_with_owner",ADM2,{"p_id":"o-adm2","p_slug":"o-adm2","p_name":"n","p_type":"private_company","p_industry":"x","p_county":"Montserrado","p_city_district":"M","p_description":"d","p_logo_text":None,"p_website":None,"p_contact_email":None,"p_contact_phone":None,"p_settings":None}); check("active user: same RPC payload succeeds (positive control)", s==200, f"{s} {b}")
# org admin takeover (F-14)
s,b=call("PATCH","/organization_memberships?id=eq.m-http-adm",ADM2,{"org_role":"owner"}); check("org admin cannot promote self to owner via PATCH", s in (401,403), f"{s} {b}")
s,b=call("PATCH","/organization_memberships?id=eq.m-http",ADM2,{"status":"suspended"}); check("org admin cannot suspend the owner via PATCH", s in (401,403), f"{s} {b}")
s,b=call("DELETE","/organization_memberships?id=eq.m-http",ADM2); check("org admin cannot delete the owner via DELETE", s in (401,403), f"{s} {b}")
s,b=call("POST","/users",OTHER,{"id":OTHER,"email":"o@x.test","full_name":"x","primary_role":"platform_admin","system_role":"platform_admin"}); check("authenticated POST /users (direct INSERT of an admin row) rejected", s in (401,403), f"{s} {b}")
s,b=call("POST","/users?on_conflict=id",OTHER,{"id":OTHER,"email":"other@acme.test","full_name":"x","system_role":"platform_admin"}); check("authenticated upsert on /users cannot set system_role", s in (401,403), f"{s} {b}")
# --- round 4: helpers, invitations, notifications, org creation, candidate RPCs ---
s,b=call("POST","/rpc/is_platform_admin",None,{"p_user_id":ADMIN}); check("anon cannot call is_platform_admin (oracle closed)", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/get_public_candidate_profile",None,{"p_target_user_id":OWNER}); check("anon cannot call get_public_candidate_profile", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/search_candidate_profiles",None,{}); check("anon cannot call search_candidate_profiles", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/is_account_suspended",OTHER,{"p_uid":SUSP}); check("authenticated user cannot ask whether another account is suspended", s in (401,403), f"{s} {b}")
s,b=call("POST","/rpc/current_account_suspended",SUSP,{}); check("suspended user sees only their own status via the self-only wrapper (true)", s==200 and json.loads(b) is True, f"{s} {b}")
s,b=call("POST","/rpc/current_account_suspended",OTHER,{}); check("active user's self-only wrapper is false", s==200 and json.loads(b) is False, f"{s} {b}")
s,b=call("POST","/rpc/accept_organization_invitation",OTHER,{"p_token":"tok-http-legacy"}); check("legacy OWNER invitation issued by an admin cannot be accepted", s in (401,403), f"{s} {b}")
s,b=call("POST","/notifications",OTHER,{"id":"n-http-forged","recipient_user_id":OWNER,"category":"billing","title":"Payment approved","message":"x","action_url":"https://evil.example"}); check("forged notification for an unrelated user rejected", s in (401,403), f"{s} {b}")
s,b=call("POST","/notifications?select=id",OTHER,{"id":"n-http-self","recipient_user_id":OTHER,"category":"system","title":"t","message":"m","action_url":"/billing"}); check("notification to self with a relative link still works", s in (200,201), f"{s} {b}")
s,b=call("POST","/organizations",OTHER,{"id":"o-direct","slug":"o-direct","name":"Ministry of Finance","type":"government","industry":"x","county":"Montserrado","city_district":"M","description":"d"}); check("direct POST /organizations rejected (RPC only)", s in (401,403), f"{s} {b}")
print(f"\n{sum(res)}/{len(res)} passed")
import sys; sys.exit(0 if all(res) else 1)
