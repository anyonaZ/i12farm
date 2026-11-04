// Privacy notice and terms, in both languages. A DRAFT written for the pilot:
// have a Kenyan lawyer review it before launch (Data Protection Act 2019,
// ODPC registration, consumer protection). Change UPDATED when you edit it.
export const UPDATED = '2026-11-04';
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '';

export interface LegalSection {
  heading: string;
  body: string[]; // paragraphs; "- " at the start makes a bullet
}

type Doc = { title: string; intro: string; sections: LegalSection[] };

export const PRIVACY: Record<'en' | 'sw', Doc> = {
  en: {
    title: 'Privacy notice',
    intro:
      'i12farm helps buyers find farms and lets farms sell, get paid and reach vets. This notice says what we keep about you, why, who sees it, and how to have it changed or removed.',
    sections: [
      {
        heading: 'What we keep',
        body: [
          '- Your account: name, phone number, email (optional), password (only as a scrambled hash), language and county.',
          '- Farms: name, farmer, description, products, prices, photos, phone and WhatsApp numbers, and the exact location you pin.',
          '- Orders and payments: what was ordered, amounts, your M-Pesa number and receipt, and the order history.',
          '- Messages between buyers and farms, reviews, vet requests and partner messages.',
          '- How the app is used (pages opened, buttons tapped), so we can improve it. This is not sold or shared.',
        ],
      },
      {
        heading: 'Who sees what',
        body: [
          '- Everyone: published farm details, products, prices, photos, reviews, and the farm’s public phone. The farm’s pin is approximate (about 1 km) unless the farm chooses exact.',
          '- A farm you order from: your name, phone and delivery note for that order.',
          '- A vet who accepts your request: your name and phone. Vets see neither before accepting.',
          '- Partners who send SMS news: only how many farms receive it, never phone numbers.',
          '- i12farm staff: what is needed to run payments, payouts and support. Every staff action on accounts is logged.',
        ],
      },
      {
        heading: 'Services we use',
        body: [
          'Safaricom M-Pesa (payments), Africa’s Talking (SMS and USSD), an email provider (sign-in links), Google (only if you sign in with Google), and our hosting and photo storage providers. They receive only what they need for that job.',
        ],
      },
      {
        heading: 'How long we keep it',
        body: [
          'Your account stays until you delete it. Orders, payments and the money ledger are kept as long as tax and payment laws require, without your name or contact once you delete your account. SMS and app-usage records are kept for up to two years.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'Under Kenya’s Data Protection Act 2019 you can see the data we hold, correct it, object to its use, and have it deleted. In the app: Account → Download my data, and Account → Delete my account. Reply STOP to any partner SMS to stop them.',
          'You can also complain to the Office of the Data Protection Commissioner (ODPC).',
        ],
      },
    ],
  },
  sw: {
    title: 'Taarifa ya faragha',
    intro:
      'i12farm inasaidia wanunuzi kupata mashamba na mashamba kuuza, kulipwa na kupata madaktari wa mifugo. Taarifa hii inaeleza tunachohifadhi kukuhusu, kwa nini, nani anakiona, na jinsi ya kukibadilisha au kukiondoa.',
    sections: [
      {
        heading: 'Tunachohifadhi',
        body: [
          '- Akaunti yako: jina, nambari ya simu, barua pepe (si lazima), nenosiri (kwa njia iliyofichwa tu), lugha na kaunti.',
          '- Mashamba: jina, mkulima, maelezo, bidhaa, bei, picha, nambari za simu na WhatsApp, na mahali halisi ulipoweka alama.',
          '- Oda na malipo: kilichoagizwa, kiasi, nambari yako ya M-Pesa na risiti, na historia ya oda.',
          '- Ujumbe kati ya wanunuzi na mashamba, maoni, maombi ya daktari na ujumbe wa washirika.',
          '- Jinsi app inavyotumika (kurasa zilizofunguliwa, vitufe vilivyobonyezwa), ili tuiboreshe. Hatuuzi wala kushiriki taarifa hizi.',
        ],
      },
      {
        heading: 'Nani anaona nini',
        body: [
          '- Kila mtu: maelezo ya shamba lililochapishwa, bidhaa, bei, picha, maoni, na simu ya shamba. Alama ya shamba ni ya kukadiria (karibu kilomita 1) isipokuwa shamba likichagua mahali halisi.',
          '- Shamba unaloagiza kutoka kwake: jina lako, simu na maelezo ya kupeleka kwa oda hiyo.',
          '- Daktari anayekubali ombi lako: jina lako na simu. Madaktari hawazioni kabla ya kukubali.',
          '- Washirika wanaotuma habari kwa SMS: idadi ya mashamba yanayopokea tu, kamwe si nambari za simu.',
          '- Wafanyakazi wa i12farm: kinachohitajika kuendesha malipo na usaidizi. Kila hatua yao kwenye akaunti hurekodiwa.',
        ],
      },
      {
        heading: 'Huduma tunazotumia',
        body: [
          'Safaricom M-Pesa (malipo), Africa’s Talking (SMS na USSD), mtoa huduma wa barua pepe (viungo vya kuingia), Google (ukiingia kwa Google tu), na watoa huduma wa seva na kuhifadhi picha. Wanapata tu kinachohitajika kwa kazi hiyo.',
        ],
      },
      {
        heading: 'Tunahifadhi kwa muda gani',
        body: [
          'Akaunti yako inabaki hadi uifute. Oda, malipo na daftari la pesa huhifadhiwa kwa muda sheria za kodi na malipo zinavyotaka, bila jina lako wala mawasiliano ukifuta akaunti. Kumbukumbu za SMS na matumizi ya app huhifadhiwa hadi miaka miwili.',
        ],
      },
      {
        heading: 'Haki zako',
        body: [
          'Chini ya Sheria ya Kulinda Data ya Kenya 2019 unaweza kuona data tuliyo nayo, kuirekebisha, kupinga matumizi yake, na kuifuta. Kwenye app: Akaunti → Pakua data yangu, na Akaunti → Futa akaunti yangu. Jibu STOP kwa SMS yoyote ya mshirika kuzisimamisha.',
          'Unaweza pia kulalamika kwa Ofisi ya Kamishna wa Kulinda Data (ODPC).',
        ],
      },
    ],
  },
};

export const TERMS: Record<'en' | 'sw', Doc> = {
  en: {
    title: 'Terms of use',
    intro: 'By using i12farm you agree to these terms. They are short on purpose.',
    sections: [
      {
        heading: 'What i12farm does',
        body: [
          'i12farm lists farms and lets buyers order and pay through M-Pesa. The farm sells the goods; i12farm holds the payment until the buyer confirms receipt, then pays the farm its share after a commission.',
        ],
      },
      {
        heading: 'Payments and refunds',
        body: [
          '- If a farm declines or does not answer a paid order in time, the order is declined and the buyer is refunded in full.',
          '- Once a buyer confirms receipt (or does not respond within a few days of the order being ready), the farm is paid.',
          '- Problems with an order: message the farm in the app first, then contact i12farm.',
        ],
      },
      {
        heading: 'Farms',
        body: [
          'Farms must describe their products honestly, keep prices and stock up to date, and only list what they are allowed to sell. Verified badges mean an i12farm agent has visited the farm, not that we guarantee every product.',
        ],
      },
      {
        heading: 'Vets and partners',
        body: [
          'Vet requests connect farmers with vets; the vet and the farmer agree the visit and its fee between themselves. Partner SMS are reviewed by i12farm before they are sent.',
        ],
      },
      {
        heading: 'Fair use',
        body: ['No fake listings, fake reviews, spam or harassment. We may hide listings or suspend accounts that break these terms.'],
      },
    ],
  },
  sw: {
    title: 'Masharti ya matumizi',
    intro: 'Kwa kutumia i12farm unakubali masharti haya. Ni mafupi kwa makusudi.',
    sections: [
      {
        heading: 'i12farm inafanya nini',
        body: [
          'i12farm inaonyesha mashamba na kuwawezesha wanunuzi kuagiza na kulipa kwa M-Pesa. Shamba ndilo linauza bidhaa; i12farm hushikilia malipo hadi mnunuzi athibitishe amepokea, kisha hulipa shamba sehemu yake baada ya kamisheni.',
        ],
      },
      {
        heading: 'Malipo na kurudishiwa pesa',
        body: [
          '- Shamba likikataa au lisipojibu oda iliyolipwa kwa wakati, oda hukataliwa na mnunuzi hurudishiwa pesa zote.',
          '- Mnunuzi akithibitisha amepokea (au asipojibu siku chache baada ya oda kuwa tayari), shamba hulipwa.',
          '- Tatizo na oda: tuma ujumbe kwa shamba kwenye app kwanza, kisha wasiliana na i12farm.',
        ],
      },
      {
        heading: 'Mashamba',
        body: [
          'Mashamba lazima yaeleze bidhaa kwa ukweli, yasasishe bei na idadi, na kuorodhesha tu kile yanachoruhusiwa kuuza. Alama ya "Limethibitishwa" ina maana wakala wa i12farm ametembelea shamba, si kwamba tunahakikisha kila bidhaa.',
        ],
      },
      {
        heading: 'Madaktari na washirika',
        body: [
          'Maombi ya daktari huwaunganisha wakulima na madaktari; daktari na mkulima hukubaliana kuhusu ziara na malipo yake wenyewe. SMS za washirika hukaguliwa na i12farm kabla ya kutumwa.',
        ],
      },
      {
        heading: 'Matumizi ya haki',
        body: [
          'Hakuna bidhaa za uongo, maoni ya uongo, barua taka wala unyanyasaji. Tunaweza kuficha bidhaa au kusimamisha akaunti zinazovunja masharti haya.',
        ],
      },
    ],
  },
};
