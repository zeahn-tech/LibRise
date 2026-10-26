/**
 * documents.ts — the text of the four legal documents.
 *
 * Every statement here describes something LibRise actually does (checked against the code and docs/). When a
 * feature changes, update the matching sentence and bump LEGAL.documentVersion in legalConfig.ts.
 * Operator-specific facts (company name, email, response times, governing law) come from legalConfig.ts.
 *
 * Inline formatting understood by the renderer: **bold** and [label](href).
 */

import { LEGAL, type LegalSlug } from './legalConfig';
import { STORAGE_REGISTRY } from '../lib/consent';

export type LegalBlock =
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'note'; text: string };

export interface LegalSection {
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  summary: string;
  sections: LegalSection[];
}

const p = (text: string): LegalBlock => ({ t: 'p', text });
const ul = (...items: string[]): LegalBlock => ({ t: 'ul', items });
const note = (text: string): LegalBlock => ({ t: 'note', text });
const table = (head: string[], rows: string[][]): LegalBlock => ({ t: 'table', head, rows });

const email = `[${LEGAL.supportEmail}](mailto:${LEGAL.supportEmail})`;
const who = `${LEGAL.operatorName} (“${LEGAL.productName}”, “we”, “us”)`;
const contactLine = LEGAL.postalAddress ? `${email}, or by post to ${LEGAL.postalAddress}` : email;

/* ------------------------------------------------------------------------------------------------------------- */
/*  PRIVACY POLICY                                                                                               */
/* ------------------------------------------------------------------------------------------------------------- */

const privacy: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy',
  summary: `How ${LEGAL.productName} collects, uses, shares and protects your personal information.`,
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are',
      blocks: [
        p(`${who} runs ${LEGAL.productName}, an online marketplace that connects job seekers, employers, recruiters, businesses, investors and organisations across Liberia. We decide how and why your personal information is used, so we are responsible for it.`),
        p(`Contact us at ${contactLine} for anything in this policy.`),
        p('This policy applies to the LibRise website and installable app (a progressive web app). It should be read together with our [Terms of Service](#/legal/terms), [Refund Policy](#/legal/refunds) and [Cookie Policy](#/legal/cookies).')
      ]
    },
    {
      id: 'what-we-collect',
      heading: 'Information we collect',
      blocks: [
        p('What we hold depends on how you use LibRise. We collect only what the features you use need.'),
        table(
          ['What', 'Examples', 'Why we need it'],
          [
            ['Account details', 'Full name, email address, phone number (optional), county, your role (job seeker, employer, recruiter, investor/buyer, etc.), password', 'To create and secure your account, send verification and security emails, and show you the right tools. Passwords are handled by our authentication provider and stored only as a secure hash.'],
            ['Candidate profile and CV', 'Skills, work history, education, summary, expected salary, CV file or text, profile visibility settings', 'To let you apply for opportunities and, if you allow it, be found by employers.'],
            ['Applications', 'Cover note, screening answers, CV files and supporting documents (certificates, transcripts, ID), application status and employer notes', 'To deliver your application to the employer you applied to and track its progress.'],
            ['Organisation and listings', 'Organisation name, type, county, registration and tax numbers, team members and roles, vacancies, tenders, scholarships, business-for-sale listings (including photos and financial summaries)', 'To publish listings, manage teams and apply verification.'],
            ['Verification evidence', 'Business registry certificates, tax clearance, accreditation letters, permits, ownership documents, national ID, and your notes', 'To check that an organisation is genuine before a verification badge is given.'],
            ['Messages and reports', 'Messages and attachments between users, NDA/access requests, reports you file about listings or users', 'To let you communicate, and to investigate abuse and scams.'],
            ['Payments', 'The plan or package, amount, mobile-money network (MTN MoMo or Orange Money), the transaction ID and sender phone number you submit, our reference code, review outcome', 'To confirm your payment by hand and activate what you paid for. We never ask for your mobile-money PIN.'],
            ['Usage, security and device data', 'Sign-in sessions, IP address, browser/device type, security events, audit logs, rate-limit counters, error logs', 'To keep accounts and the platform secure, prevent abuse, and fix problems.'],
            ['Content you ask AI to process', 'CV text, your profile, job notes, search queries, listing text', 'To power the AI features you choose to use (see “AI features”).'],
            ['Information stored on your device', 'Sign-in session, cached profile, preferences, offline app files', 'See our [Cookie Policy](#/legal/cookies).']
          ]
        ),
        p('We do not knowingly collect special categories of data (such as health, religion or political views). Please do not put them in your profile, CV or messages unless an employer genuinely needs them. Our AI matching removes protected attributes before it scores a candidate.')
      ]
    },
    {
      id: 'how-we-use',
      heading: 'How we use your information',
      blocks: [
        ul(
          'To provide LibRise: create your account, show opportunities, deliver applications, run messaging, and manage organisations and subscriptions.',
          'To verify organisations and review listings for scams, including an automated scan that flags things like requests for application fees.',
          'To process and confirm payments made by mobile money.',
          'To send service messages: email verification, password resets, security alerts, application and payment updates, and in-app notifications.',
          'To keep LibRise safe: detect fraud and abuse, apply rate limits, enforce our Terms, and keep an audit log of important actions.',
          'To improve the product using aggregated, first-party statistics (for example how many vacancies were posted per county). Platform administrators see these dashboards. We do not use third-party analytics or advertising trackers.',
          'To meet legal obligations and respond to lawful requests from authorities.'
        ),
        p('We rely on: your agreement to our Terms (to provide the service), your consent (for optional features such as non-essential storage on your device and making your profile visible), our legitimate interests in running a safe, working platform, and legal obligations.'),
        p('We do not sell your personal information, and we do not show third-party advertising.')
      ]
    },
    {
      id: 'who-sees-what',
      heading: 'Who can see your information',
      blocks: [
        table(
          ['Information', 'Who can see it'],
          [
            ['Public listings (vacancies, tenders, scholarships, business listings) and organisation name and verification badge', 'Anyone who visits LibRise. Confidential business listings hide sensitive details until a buyer’s NDA request is approved.'],
            ['Your candidate profile', 'Depends on your privacy settings: from everyone, to verified employers only, to anonymous, hidden or private. You choose whether your email, phone, salary expectations and CV are shown.'],
            ['An application and its documents', 'You, and members of the employing organisation that received it. They can view and download the files you attached. Other organisations cannot.'],
            ['Verification evidence', 'You (the person who submitted it), platform administrators and verification officers. Files sit in private storage and are opened only through short-lived secure links.'],
            ['Messages and attachments', 'The people in the conversation. Our trust and safety team may review a conversation if it is reported or needed to investigate abuse.'],
            ['Payment details', 'Your organisation’s authorised members and platform administrators who review payments.'],
            ['Account, security and audit data', 'You (for your own sessions) and platform administrators.']
          ]
        ),
        p('Employers and other users who receive your information (for example an employer who receives your CV) become responsible for how they use it. Our Terms require them to use it only for the purpose it was shared.')
      ]
    },
    {
      id: 'ai-features',
      heading: 'AI features',
      blocks: [
        p('LibRise offers optional AI tools: CV parsing, job and candidate recommendations and matching, job-description drafting, semantic search, and a scam check for listings.'),
        ul(
          'When you use one, the relevant content (for example your CV text, your skills and county, your job notes, your search query, or a listing’s text) is sent from our server to Google’s Gemini API to produce the result. Your request is not sent to Google unless you use an AI feature.',
          'Before matching, we remove protected personal attributes from a candidate profile and send only job-related information. Where the Google service is not configured or is unavailable, a built-in rule-based engine on our server is used instead.',
          'AI output is a suggestion, not a decision. People, not AI, decide who is hired or whether a listing is removed. AI results can be wrong; please check them.',
          'We do not control Google’s own practices. Google’s terms and privacy policy apply to what it receives. Avoid putting information into AI features that you do not want processed this way.'
        )
      ]
    },
    {
      id: 'sharing',
      heading: 'Service providers and other sharing',
      blocks: [
        p('We use trusted providers to run LibRise. They may only use your information to provide their service to us:'),
        table(
          ['Provider', 'What for', 'What they handle'],
          [
            ['Supabase', 'Authentication, database, private file storage, and sending account emails', 'Account data, profiles, applications, messages, documents, payments records'],
            ['Our hosting providers', 'Serving the website/app and our API server', 'Technical request data such as IP address'],
            ['Google (Gemini API)', 'AI features you choose to use', 'The content you submit to those features'],
            ['Google Fonts', 'Typefaces, only if you accept third-party content', 'Your IP address and browser details when fonts load'],
            ['MTN Mobile Money and Orange Money', 'The networks you use to pay us', 'Your payment as handled by the network; they have their own privacy terms']
          ]
        ),
        p('We may also share information: with the employer or counterparty you choose to apply to or contact; if the law or a court requires it; to protect people from fraud, scams or harm; and in a sale, merger or reorganisation of the business (we would tell you and the same protections would continue).')
      ]
    },
    {
      id: 'transfers',
      heading: 'Where your information is processed',
      blocks: [
        p('Our providers may process information on servers outside Liberia. When that happens we rely on those providers’ security commitments and share only what is needed. By using LibRise you understand your information may be stored and processed in other countries.')
      ]
    },
    {
      id: 'retention',
      heading: 'How long we keep information',
      blocks: [
        ul(
          'Account and profile data: while your account is open.',
          'Applications and their documents: as long as the application record exists, so employers and you can refer back to it.',
          'Verification evidence: for as long as needed to support the badge and our audit trail.',
          'Payment records, audit logs and safety reports: as long as needed for accounting, security, fraud prevention, and legal claims, even after an account is closed.',
          'Temporary copies on your device (offline cache): up to 24 hours for server responses; see the Cookie Policy.'
        ),
        p('When information is no longer needed, we delete it or remove what identifies you.')
      ]
    },
    {
      id: 'your-rights',
      heading: 'Your choices and rights',
      blocks: [
        ul(
          'Access and correction: you can edit your profile, contact details and organisation details in the app. For a copy of your information or a correction you cannot make yourself, contact us.',
          'Privacy settings: control who sees your candidate profile, email, phone, salary expectations and CV in your profile settings.',
          'Cookies and device storage: change your choices any time with “Cookie settings” in the footer.',
          'Deletion: there is no one-tap account deletion yet. Email us from your registered address and we will delete or anonymise your account and data, except information we must keep (see “How long we keep information”).',
          'Objection and withdrawal of consent: you can object to a use of your information or withdraw consent, which does not affect what we did before.',
          'Complaints: tell us first so we can fix it. You may also complain to any authority that regulates data protection where you live.'
        ),
        p(`To use these rights email ${email} from the address on your account. We may need to confirm it is you, and we aim to respond within ${LEGAL.privacyRequestResponseDays} days.`)
      ]
    },
    {
      id: 'security',
      heading: 'How we protect information',
      blocks: [
        ul(
          'Data in transit is encrypted over HTTPS.',
          'Access to every table is limited by database rules so users see only what they are allowed to; verification and application documents are in private storage and opened through links that expire after about an hour.',
          'Uploaded files are checked for type, size and contents before they are accepted.',
          'We rate-limit sensitive actions, monitor for abuse, and record important actions in an audit log.'
        ),
        p('No system is perfectly secure. Use a strong, unique password and tell us straight away if you think your account has been accessed by someone else.')
      ]
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [p(`LibRise is for people aged ${LEGAL.minimumAge} and over. We do not knowingly collect information from anyone younger. If you believe a child has given us information, contact us and we will remove it.`)]
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [p(`We will update this page when our practices change and show the new “last updated” date. If a change is significant we will tell you in the app or by email. Current version: ${LEGAL.documentVersion}.`)]
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(`${LEGAL.operatorName} — ${contactLine}.`)]
    }
  ]
};

/* ------------------------------------------------------------------------------------------------------------- */
/*  TERMS OF SERVICE                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

const terms: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Service',
  summary: `The rules for using ${LEGAL.productName}, for everyone: job seekers, employers, recruiters, sellers and buyers.`,
  sections: [
    {
      id: 'agreement',
      heading: 'Agreement',
      blocks: [
        p(`These Terms are an agreement between you and ${who}. By creating an account or using ${LEGAL.productName} you accept them, together with our [Privacy Policy](#/legal/privacy), [Refund Policy](#/legal/refunds) and [Cookie Policy](#/legal/cookies). If you use LibRise for an organisation, you confirm you have authority to bind it. If you do not agree, do not use LibRise.`)
      ]
    },
    {
      id: 'what-we-are',
      heading: 'What LibRise is, and is not',
      blocks: [
        p('LibRise is an online marketplace. We provide the place where opportunities (jobs, internships, consultancies, tenders, scholarships, grants and similar), businesses for sale, and the people and organisations behind them can find each other.'),
        ul(
          'We are not an employer, recruitment agent, broker, investment adviser, lender or party to any hire, contract, sale or investment made through LibRise. Those are between the users involved.',
          'We do not guarantee that any listing is genuine, accurate or successful, that any applicant is suitable, or that any deal will complete. Do your own checks before you share money, personal documents or confidential information.',
          'A verification badge shows that certain documents were reviewed at a point in time. It is not a guarantee, endorsement or ongoing audit of the organisation (see “Verification”).'
        )
      ]
    },
    {
      id: 'accounts',
      heading: 'Accounts',
      blocks: [
        ul(
          `You must be at least ${LEGAL.minimumAge} years old and able to enter a binding agreement.`,
          'Give accurate information and keep it up to date. Confirm your email address when asked; some features may stay limited until you do.',
          'You are responsible for your password and for activity under your account. Tell us immediately if you think it has been compromised.',
          'Keep one personal account. Do not impersonate anyone, share an account, or create accounts to avoid a restriction.',
          'Organisation accounts may have several members. The organisation is responsible for what its members do and for removing people who should no longer have access.'
        )
      ]
    },
    {
      id: 'content',
      heading: 'Your content and listings',
      blocks: [
        p('You own what you post (profiles, CVs, listings, messages, documents). You give us a non-exclusive, worldwide licence to host, display, copy and process it as needed to run LibRise and show it to the audiences you choose. This ends when you delete it, except for copies we must keep (for example backups, records of applications already delivered, and safety or legal records).'),
        p('You promise that you have the right to post your content and that it is true, lawful and not misleading. You must not post or do any of the following:'),
        ul(
          '**Charging job seekers.** Asking applicants to pay any fee to apply, to be interviewed, for registration, processing, training or “clearance”, or to send money by wire, cash or similar channels. We automatically flag and may quarantine listings that look like this.',
          'Fake or misleading vacancies, tenders, scholarships or business listings, or listings you are not authorised to post.',
          'Discrimination in a listing or hiring decision on grounds such as ethnicity, religion, gender, disability or age, except where the law allows it.',
          'Illegal, hateful, harassing, sexually explicit or violent content; malware; or attempts to break, scrape or overload LibRise or access data you are not entitled to.',
          'Using applicants’ or other users’ personal information for anything other than the purpose it was shared (for example selling it or sending unrelated marketing).',
          'Moving people off LibRise to avoid our rules, or contacting users after they have asked you to stop.'
        ),
        p('We scan listings automatically and may remove or hold content that breaks these rules or that we reasonably think is unsafe. Users can report listings and accounts.')
      ]
    },
    {
      id: 'applications',
      heading: 'Applications and documents',
      blocks: [
        p('When you apply, the employer can see your application and the files you attach. Only attach what you are comfortable sharing. Employers must use applicants’ information only to assess and manage hiring and must protect it. LibRise does not control employers’ decisions and is not responsible for them.'),
        p('Organisations cannot apply to their own posting, and you may have only one active application per opportunity.')
      ]
    },
    {
      id: 'business-marketplace',
      heading: 'Business marketplace and confidentiality',
      blocks: [
        p('Business-for-sale listings are invitations to enquire, not offers. Sellers must be authorised to sell and must describe the business honestly. Buyers must carry out their own due diligence with professional advice.'),
        p('Some listings are confidential and reveal sensitive details only after the seller approves an NDA request. If you receive confidential information you must keep it confidential and use it only to evaluate the deal. LibRise is not a party to any NDA or transaction and does not hold funds for them.')
      ]
    },
    {
      id: 'verification',
      heading: 'Verification and badges',
      blocks: [
        p('Verification officers or administrators may review documents such as business registration, tax clearance, accreditation letters, permits and ownership papers. A badge means we reviewed what was submitted and found it acceptable at that time. It does not mean we endorse the organisation, that it is free of risk, or that its listings are accurate.'),
        p('You must submit only genuine documents. We may reject a request, decline to give a badge, or remove a badge if documents are false, expired or no longer valid, or if the organisation breaks these Terms.')
      ]
    },
    {
      id: 'messaging',
      heading: 'Messaging and conduct',
      blocks: [
        p('Be respectful. Do not harass, threaten, spam or defraud other users. Messages are private to the people in a conversation, but we may review reported messages and act on abuse. We may restrict messaging, applying, posting or deal-room access, or suspend an account, if we reasonably believe these Terms were broken. Restrictions may be temporary or until lifted by an administrator.')
      ]
    },
    {
      id: 'ai',
      heading: 'AI features',
      blocks: [
        p('AI tools (CV parsing, matching, recommendations, drafting, search and scam check) are provided to assist you. Their results can be incomplete or wrong, and a scam check is not proof that a listing is safe or unsafe. You are responsible for reviewing AI output before relying on it or publishing it. Do not use AI features to submit information you have no right to share.')
      ]
    },
    {
      id: 'fees',
      heading: 'Fees and payments',
      blocks: [
        p('Browsing LibRise and applying for opportunities is free for job seekers. Organisations get a limited number of free published vacancies; extra vacancy publishing, visibility packages (such as Featured or Premium) and paid plans cost money. The price is shown at checkout and is set by us in the system, so it cannot be changed from your device.'),
        ul(
          'Payments are made by MTN Mobile Money or Orange Money to our account. After you send the money you submit the transaction ID, and a member of our team checks it by hand against our mobile-money records. Confirmation is not instant, and we do not promise a turnaround time.',
          `An unsubmitted payment request expires after ${LEGAL.paymentWindowHours} hours.`,
          'Your vacancy or plan is activated only after we approve the payment. If we cannot confirm it, we will reject it with a reason and you can try again.',
          'You pay any mobile-money network charges. Prices may change for future purchases; we will not change what you have already paid for.',
          'Refunds and cancellations are covered by our [Refund Policy](#/legal/refunds).'
        )
      ]
    },
    {
      id: 'termination',
      heading: 'Suspension and closing accounts',
      blocks: [
        p('You can stop using LibRise at any time and ask us to close your account (see the Privacy Policy). We may suspend or close an account, remove content, or withdraw a badge if you break these Terms, put others at risk, fail to pay what you owe, or if the law requires. Where reasonable we will tell you why. To appeal, email us with your account email and the details.'),
        p('Sections that by their nature should continue (for example content licences, payments owed, liability limits and governing law) survive closure.')
      ]
    },
    {
      id: 'ip',
      heading: 'Our rights',
      blocks: [p('LibRise, its design, software, brand and the compilation of listings belong to us or our licensors. You may use them only as these Terms allow. Do not copy, resell or reverse-engineer them, or use our name or badges without permission.')]
    },
    {
      id: 'disclaimers',
      heading: 'Availability and disclaimers',
      blocks: [
        p('LibRise is provided “as is” and “as available”. We work to keep it running, including on slow or unreliable connections, but we do not promise it will be uninterrupted or error-free. To the extent the law allows, we disclaim all warranties not expressly stated here, including fitness for a particular purpose and that listings, users or AI output are accurate or reliable.')
      ]
    },
    {
      id: 'liability',
      heading: 'Limits on our responsibility',
      blocks: [
        p('To the extent the law allows: we are not responsible for what users post or do, for hiring, contract, sale or investment decisions, or for losses from scams or misrepresentation by other users; and we are not liable for indirect or consequential loss, or lost profits, opportunities or data.'),
        p('Where we are liable to you despite the above, our total liability for all claims is limited to the greater of the amount you paid us in the 12 months before the event or USD 100.'),
        p('Nothing in these Terms limits liability that cannot lawfully be limited, such as for fraud or for death or personal injury caused by negligence, or removes rights you have under consumer-protection law.')
      ]
    },
    {
      id: 'indemnity',
      heading: 'If you cause us loss',
      blocks: [p('You agree to cover reasonable losses and costs we suffer because you break these Terms, post unlawful content, or infringe another person’s rights.')]
    },
    {
      id: 'law',
      heading: 'Governing law and disputes',
      blocks: [
        p(`These Terms are governed by the laws of ${LEGAL.governingLaw}. Please contact us first so we can try to resolve a problem informally. If that fails, the dispute will be decided by ${LEGAL.courts}, unless the law gives you the right to bring it elsewhere.`)
      ]
    },
    {
      id: 'changes',
      heading: 'Changes to these Terms',
      blocks: [p(`We may update these Terms. We will post the new version here with its date and, for significant changes, notify you. If you keep using LibRise after a change takes effect, you accept it. Current version: ${LEGAL.documentVersion}.`)]
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(`${LEGAL.operatorName} — ${contactLine}.`)]
    }
  ]
};

/* ------------------------------------------------------------------------------------------------------------- */
/*  REFUND POLICY                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

const refunds: LegalDocument = {
  slug: 'refunds',
  title: 'Refund Policy',
  summary: 'When you can get your money back, how to ask, and how cancellations work.',
  sections: [
    {
      id: 'how-payments-work',
      heading: 'How payments work, in short',
      blocks: [
        p('You pay for vacancy publishing, visibility packages and plans by sending MTN Mobile Money or Orange Money to our account, then submitting the transaction ID. We check it by hand, and only after we approve it is your vacancy published or your plan activated.'),
        p('Because there is no card or automatic payment, **no money is taken from you by LibRise itself**. Money leaves your mobile-money account only when you send it.')
      ]
    },
    {
      id: 'automatic-outcomes',
      heading: 'What happens to your money in each case',
      blocks: [
        table(
          ['Situation', 'What happens'],
          [
            ['You start a payment but never send money or submit a transaction ID', `Nothing is charged. The request expires after ${LEGAL.paymentWindowHours} hours.`],
            ['You sent money but the payment is still waiting for review', 'Please wait for our review. If it is taking unusually long, email us with your details (below).'],
            ['We approve your payment', 'Your vacancy or plan is activated. See “When we refund” for what is still refundable.'],
            ['We reject your payment (for example we cannot find the transaction, or the amount or sender does not match)', 'The reason is shown to you. If you did send money that reached us, we refund it (see below). If the money did not reach us, you should contact your mobile-money provider.']
          ]
        )
      ]
    },
    {
      id: 'when-we-refund',
      heading: 'When we refund',
      blocks: [
        p(`Ask for a refund within ${LEGAL.refundRequestWindowDays} days of the payment. We will refund the amount you paid to us in these cases:`),
        ul(
          'Duplicate payment: you paid twice for the same vacancy, package or plan period.',
          'Overpayment: you sent more than the price shown at checkout (we refund the difference).',
          'Rejected payment: we rejected your payment but the money did reach our account.',
          'Not delivered: we approved your payment but, because of a fault on our side, the vacancy was not published or the plan was not activated, and we could not fix it within a reasonable time.',
          'Wrongly removed: we removed a paid listing or ended a plan early and we later find the removal was our mistake.'
        ),
        p('Where we refund part of a payment, we refund the unused or undelivered part.')
      ]
    },
    {
      id: 'no-refund',
      heading: 'When we do not refund',
      blocks: [
        ul(
          'Change of mind after your vacancy has been published or your plan has started, or because you received fewer applicants than you hoped.',
          'A listing we removed or held because it broke our [Terms of Service](#/legal/terms) (for example it asked applicants to pay a fee), or an account we suspended for breaking them.',
          'A visibility package (Featured or Premium) that has already run for its period.',
          'Mobile-money charges or fees taken by MTN, Orange or your bank/agent.',
          'Money you sent to a number that is not the one shown in our checkout, or to someone pretending to be LibRise. Please report it to us and to your provider; we cannot refund money we never received.',
          'Payments we could not match because the transaction ID or sender number was entered incorrectly and you do not provide correct details within the refund window.'
        )
      ]
    },
    {
      id: 'cancelling',
      heading: 'Cancelling a plan',
      blocks: [
        p('You can cancel a paid plan from the Billing page.'),
        ul(
          '**Cancel at the end of the period:** you keep the paid features until the end of the period you paid for, and the plan does not continue. This is the default.',
          '**Switch to Free now:** your plan ends immediately and the remaining time is **not refunded**.',
          'After cancelling you stay on the Free plan with its limits. Your data is kept. Vacancies already published remain subject to the limits of the plan you are on.'
        ),
        p('Annual plans are paid for the whole year and are not refunded part-way through, except where the “When we refund” list applies.')
      ]
    },
    {
      id: 'how-to-ask',
      heading: 'How to ask for a refund',
      blocks: [
        p(`Email ${email} from the address on your account with:`),
        ul(
          'Your reference code (it looks like OHL-XXXX-XXXX) and the vacancy or plan it was for',
          'The mobile-money transaction ID, the network (MTN or Orange), the sender phone number, the amount and the date',
          'Why you are asking for a refund'
        ),
        p(`We will review your request and tell you our decision within ${LEGAL.refundDecisionBusinessDays} business days. If we ask for more information, the time starts again when you reply.`)
      ]
    },
    {
      id: 'how-we-refund',
      heading: 'How we pay you back',
      blocks: [
        p('Approved refunds are sent by mobile money to the same number and network the payment came from, for the amount being refunded, less any network charges we cannot avoid. It is sent manually, so the time it takes to arrive depends on us and the mobile-money network. We will tell you when it has been sent.'),
        p('If a refund is refused you will get the reason. You can reply to ask us to look again.')
      ]
    },
    {
      id: 'your-rights',
      heading: 'Your legal rights',
      blocks: [p('This policy does not remove any rights you have under consumer-protection law that cannot be excluded by agreement.')]
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(`${LEGAL.operatorName} — ${contactLine}.`)]
    }
  ]
};

/* ------------------------------------------------------------------------------------------------------------- */
/*  COOKIE POLICY                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

const categoryLabel = { necessary: 'Necessary', preferences: 'Preferences', thirdParty: 'Third-party content' } as const;

const cookies: LegalDocument = {
  slug: 'cookies',
  title: 'Cookie Policy',
  summary: 'What LibRise stores on your phone or computer, why, and how to control it.',
  sections: [
    {
      id: 'what-this-covers',
      heading: 'What this covers',
      blocks: [
        p(`${LEGAL.productName} is a web app. Like most apps it stores small amounts of information in your browser or on your device. This is called “local storage” or “cache storage”, and it plays the role that cookies do. This policy lists everything we store and why.`),
        note('LibRise does not use advertising cookies, tracking pixels or third-party analytics. We do not sell data about what you browse.')
      ]
    },
    {
      id: 'categories',
      heading: 'The three kinds of storage',
      blocks: [
        ul(
          '**Necessary:** needed to sign you in, keep you secure and make the app work, including offline. These are always on. You can clear them in your browser, but you would be signed out and the app may not work.',
          '**Preferences:** remember your display choices. These are only stored if you agree.',
          '**Third-party content:** loads fonts from Google. This only happens if you agree. If you decline, LibRise uses your device’s standard fonts and no request is made to Google for fonts.'
        )
      ]
    },
    {
      id: 'what-we-store',
      heading: 'Everything we store',
      blocks: [
        table(
          ['Name', 'Type', 'Purpose', 'How long', 'Set by'],
          STORAGE_REGISTRY.map((i) => [`${i.name} (${categoryLabel[i.category]})`, i.where, i.purpose, i.duration, i.party])
        ),
        p('Our authentication provider’s sign-in item and our cached profile are cleared when you sign out. Offline app files and the 24-hour response cache stay until they expire or you clear site data, so on a shared phone or computer sign out and clear site data when you finish.')
      ]
    },
    {
      id: 'your-choices',
      heading: 'Your choices',
      blocks: [
        p('When you first visit you can accept all, keep only the necessary storage, or choose by category. You can change your mind at any time with “Cookie settings” in the footer of the site or the button below. If you turn a category off we delete what we stored under it (for example your saved currency).'),
        p('You can also clear site data in your browser settings, or turn off storage there, but parts of LibRise (such as staying signed in) will not work without necessary storage.')
      ]
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      blocks: [p(`If we start storing something new, we update this list and ask for your choice again where consent is needed. Current version: ${LEGAL.documentVersion}.`)]
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [p(`Questions? ${LEGAL.operatorName} — ${contactLine}. See also our [Privacy Policy](#/legal/privacy).`)]
    }
  ]
};

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = { privacy, terms, refunds, cookies };

export function getLegalDocument(slug: string): LegalDocument | null {
  return (LEGAL_DOCUMENTS as Record<string, LegalDocument>)[slug] ?? null;
}
