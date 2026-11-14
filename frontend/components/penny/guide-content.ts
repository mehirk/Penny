/**
 * The Money Guide: plain-language summaries of public information for people in Canada, written
 * for Penny from official sources (Canada.ca, the CRA, the Financial Consumer Agency of Canada,
 * CDIC, CIPF, OBSI). Every guide links its sources. Figures are for 2026 and were last checked in
 * November 2026; rules change, so the guides point to the official pages for the current numbers.
 * General education only: nothing here is personal financial, tax, or legal advice.
 */

export const GUIDES_CHECKED = "November 2026";

export type GuideCategory = "banking" | "registered" | "credit" | "tax" | "grow" | "protect";

export const CATEGORIES: { id: GuideCategory; label: string; emoji: string; blurb: string; tint: string }[] = [
  {
    id: "banking",
    label: "Banking basics",
    emoji: "🏦",
    blurb: "Accounts, fees, and your money's safety net",
    tint: "from-[#5fb0ff] to-[#4a6fe7]",
  },
  {
    id: "registered",
    label: "Government accounts",
    emoji: "🍁",
    blurb: "TFSA, RRSP, FHSA, RESP, RDSP",
    tint: "from-[#ff8a7a] to-[#e8475f]",
  },
  {
    id: "credit",
    label: "Credit & debt",
    emoji: "💳",
    blurb: "Scores, cards, loans, and student debt",
    tint: "from-[#b67df2] to-[#7b4fd8]",
  },
  {
    id: "tax",
    label: "Taxes & benefits",
    emoji: "🧾",
    blurb: "Brackets, paycheques, filing, and money you can claim",
    tint: "from-[#ffc65c] to-[#f39a2b]",
  },
  {
    id: "grow",
    label: "Save & grow",
    emoji: "🌱",
    blurb: "Budgets, emergency funds, and investing basics",
    tint: "from-[#4fd1a5] to-[#19a37f]",
  },
  {
    id: "protect",
    label: "Protect yourself",
    emoji: "🛡️",
    blurb: "Scams, your rights, and where to complain",
    tint: "from-[#7d8aa3] to-[#4b5874]",
  },
];

export type Stat = { value: string; label: string };
export type Source = { label: string; url: string };
export type Block =
  | { kind: "text"; heading?: string; body: string }
  | { kind: "list"; heading?: string; items: string[] }
  | { kind: "steps"; heading?: string; items: string[] }
  | { kind: "tip"; body: string }
  | { kind: "warning"; body: string }
  | { kind: "table"; heading?: string; columns: string[]; rows: string[][] };

export type Guide = {
  id: string;
  category: GuideCategory;
  emoji: string;
  title: string;
  tagline: string;
  minutes: number;
  /** The headline numbers, shown as big tiles. */
  stats?: Stat[];
  blocks: Block[];
  sources: Source[];
  /** A question to hand Penny AI from the guide. */
  ask?: string;
};

const FCAC = {
  label: "Financial Consumer Agency of Canada",
  url: "https://www.canada.ca/en/financial-consumer-agency.html",
};
const LIMITS = {
  label: "CRA: RRSP, TFSA, and other limits by year",
  url: "https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html",
};

export const GUIDES: Guide[] = [
  // ------------------------------------------------------------------------------------ banking
  {
    id: "chequing-savings",
    category: "banking",
    emoji: "🏧",
    title: "Chequing vs. savings accounts",
    tagline: "One account to spend from, one to grow.",
    minutes: 3,
    stats: [
      { value: "2", label: "accounts most people need to start" },
      { value: "$4", label: "max monthly fee for a low-cost account" },
    ],
    blocks: [
      {
        kind: "table",
        heading: "What each one is for",
        columns: ["", "Chequing", "Savings"],
        rows: [
          ["Best for", "Paying bills, debit, e-Transfers", "Money you're setting aside"],
          ["Interest", "Little or none", "Some; high-interest savings pays more"],
          ["Transactions", "Many included (by plan)", "Few free withdrawals"],
          ["Fees", "Monthly fee unless waived", "Usually no monthly fee"],
        ],
      },
      {
        kind: "list",
        heading: "Before you pick one, compare",
        items: [
          "The monthly fee, and what waives it (a minimum balance, being a student, a direct deposit).",
          "How many transactions are included and what extras cost (e-Transfers, other banks' ATMs).",
          "The interest rate on savings, and whether a high rate is only a short promo.",
          "Whether it's covered by deposit insurance (CDIC at banks, provincial insurers at credit unions).",
        ],
      },
      {
        kind: "tip",
        body: "Many banks have no-fee student accounts. Ask for one when you show a student ID, and check when it ends after you graduate.",
      },
      {
        kind: "text",
        heading: "High-interest savings and GICs",
        body: "A high-interest savings account (HISA) pays more than a regular savings account and you can still withdraw any time. A GIC (guaranteed investment certificate) locks your money for a set term, like 1 year, in exchange for a guaranteed rate. Both can be covered by deposit insurance.",
      },
    ],
    sources: [
      FCAC,
      {
        label: "FCAC: low-cost and no-cost accounts",
        url: "https://www.canada.ca/en/financial-consumer-agency/services/industry/laws-regulations/low-cost-no-cost-accounts.html",
      },
    ],
    ask: "Should my savings go in a high-interest savings account or a GIC?",
  },
  {
    id: "low-cost-accounts",
    category: "banking",
    emoji: "🆓",
    title: "Free and low-cost bank accounts",
    tagline: "Big banks have to offer a cheap account. Some people pay nothing.",
    minutes: 2,
    stats: [
      { value: "$4", label: "max monthly fee for a low-cost chequing account" },
      { value: "$0", label: "for eligible groups (no-cost account)" },
      { value: "14", label: "banks signed the commitment" },
    ],
    blocks: [
      {
        kind: "text",
        body: "Under a commitment with the federal government (updated December 1, 2025), 14 federally regulated banks, including the largest, offer a low-cost chequing account for no more than $4 a month, with a set number of transactions and a debit card included.",
      },
      {
        kind: "list",
        heading: "Groups who may get it for free",
        items: [
          "Youth and students (check your bank's current rules)",
          "Seniors who get the Guaranteed Income Supplement",
          "People who are beneficiaries of an RDSP",
          "Other groups named in the commitment, such as some newcomers and people on social assistance",
        ],
      },
      {
        kind: "text",
        heading: "You can open an account without a job or money",
        body: "Federal rules let you open a personal account at a bank without a job, a minimum deposit, or a good credit history, as long as you have acceptable ID.",
      },
      {
        kind: "tip",
        body: "Paying $15 a month in fees costs $180 a year. Asking for a low-cost or student account can save most of that.",
      },
    ],
    sources: [
      {
        label: "FCAC: Commitment on low-cost and no-cost accounts",
        url: "https://www.canada.ca/en/financial-consumer-agency/services/industry/laws-regulations/low-cost-no-cost-accounts.html",
      },
      {
        label: "FCAC news: enhanced free and low-cost accounts",
        url: "https://www.canada.ca/en/financial-consumer-agency/news/2025/03/canadians-to-benefit-from-enhanced-free-and-low-cost-bank-accounts-this-year-march-13-2025.html",
      },
    ],
  },
  {
    id: "deposit-insurance",
    category: "banking",
    emoji: "🛟",
    title: "Is my money safe? CDIC and CIPF",
    tagline: "What happens to your money if a bank or investment firm fails.",
    minutes: 3,
    stats: [
      { value: "$100,000", label: "CDIC coverage per category, per member bank" },
      { value: "$1M", label: "CIPF coverage per account category at a member dealer" },
    ],
    blocks: [
      {
        kind: "text",
        heading: "CDIC: deposits at banks",
        body: "The Canada Deposit Insurance Corporation protects eligible deposits at member institutions (most banks) up to $100,000 per category, including interest. It's free and automatic; you don't sign up.",
      },
      {
        kind: "list",
        heading: "Each of these is its own $100,000 category",
        items: [
          "Deposits in your name alone",
          "Joint deposits (the limit is per account, not per person)",
          "Deposits held in trust",
          "Deposits in a TFSA, RRSP, RRIF, FHSA, RESP, or RDSP",
        ],
      },
      {
        kind: "table",
        heading: "Covered or not?",
        columns: ["Covered by CDIC", "Not covered"],
        rows: [
          ["Chequing and savings accounts", "Stocks, bonds, and ETFs"],
          ["GICs and other term deposits", "Mutual funds"],
          ["Foreign-currency deposits", "Crypto"],
        ],
      },
      {
        kind: "text",
        heading: "CIPF: investment accounts",
        body: "The Canadian Investor Protection Fund protects what a member investment dealer holds for you (cash and investments) if the dealer goes bankrupt, up to $1 million per account category. It does not cover your investments losing value in the market.",
      },
      {
        kind: "tip",
        body: "Credit unions are insured by their province instead of CDIC, often with similar or higher limits. Look for the member sign at the branch or online.",
      },
    ],
    sources: [
      { label: "CDIC: what we cover", url: "https://www.cdic.ca/about-di/what-we-cover" },
      { label: "Canadian Investor Protection Fund", url: "https://www.cipf.ca" },
    ],
  },
  {
    id: "banking-rights",
    category: "banking",
    emoji: "📜",
    title: "Your banking rights",
    tagline: "What banks must tell you, and how fast you get your money.",
    minutes: 3,
    blocks: [
      {
        kind: "list",
        heading: "Federal rules for banks say",
        items: [
          "They must tell you about fees clearly, and give notice before raising them.",
          "You can open a personal account with ID, without a job or minimum deposit.",
          "For a cheque of $1,500 or less deposited in person, you get the first $100 right away and the rest within a few business days.",
          "They must have a complaint process and answer complaints within 56 days.",
          "They can't pressure you or attach unwanted products to what you asked for (no coercive tied selling).",
        ],
      },
      {
        kind: "text",
        heading: "Canada's Financial Consumer Protection Framework",
        body: "Since 2022, federally regulated banks follow a stronger set of consumer rules: clear disclosures, products that suit your situation, and fair treatment. The Financial Consumer Agency of Canada (FCAC) oversees them.",
      },
      { kind: "tip", body: 'Unhappy with a bank\'s answer? See "Complaints: the 56-day path" in Protect yourself.' },
    ],
    sources: [
      FCAC,
      {
        label: "FCAC: file a complaint with your financial institution",
        url: "https://www.canada.ca/en/financial-consumer-agency/services/complaints/file-complaint-financial-institution.html",
      },
    ],
  },

  // --------------------------------------------------------------------------------- registered
  {
    id: "tfsa",
    category: "registered",
    emoji: "🧺",
    title: "TFSA: Tax-Free Savings Account",
    tagline: "Growth you never pay tax on, and withdrawals any time.",
    minutes: 4,
    stats: [
      { value: "$7,000", label: "new room for 2026" },
      { value: "$109,000", label: "total room if 18+ and in Canada since 2009" },
      { value: "18", label: "age you start getting room" },
    ],
    blocks: [
      {
        kind: "text",
        body: "A TFSA is a registered account where interest, dividends, and growth are never taxed, even when you take money out. Despite the name, it can hold more than savings: cash, GICs, and investments.",
      },
      {
        kind: "list",
        heading: "How the room works",
        items: [
          "You get new room every January 1 ($7,000 for 2026) once you're 18 and a resident with a SIN.",
          "Unused room carries forward forever.",
          "What you withdraw is added back to your room on January 1 of the next year, not right away.",
          "Putting in more than your room costs a tax of 1% of the extra, per month.",
          "Your exact room is in CRA My Account (it can lag recent deposits, so keep track yourself).",
        ],
      },
      {
        kind: "table",
        heading: "TFSA room by year",
        columns: ["Years", "Each year"],
        rows: [
          ["2009 to 2012", "$5,000"],
          ["2013 to 2014", "$5,500"],
          ["2015", "$10,000"],
          ["2016 to 2018", "$5,500"],
          ["2019 to 2022", "$6,000"],
          ["2023", "$6,500"],
          ["2024 to 2026", "$7,000"],
        ],
      },
      {
        kind: "warning",
        body: "Withdrawing and re-depositing in the same year can cause an over-contribution if you don't have enough room. The room comes back next January.",
      },
      {
        kind: "tip",
        body: "Good for an emergency fund or short-term goals, because you can take money out without tax.",
      },
    ],
    sources: [
      {
        label: "CRA: Tax-Free Savings Account",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account.html",
      },
      {
        label: "CRA: calculate your TFSA room",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/calculate-room.html",
      },
      LIMITS,
    ],
    ask: "How would a TFSA fit with my savings goals?",
  },
  {
    id: "rrsp",
    category: "registered",
    emoji: "🏖️",
    title: "RRSP: Registered Retirement Savings Plan",
    tagline: "A tax break now, tax later, built for retirement.",
    minutes: 4,
    stats: [
      { value: "$33,810", label: "2026 maximum (or 18% of 2025 earned income)" },
      { value: "Mar 1, 2027", label: "deadline for 2026 deductions" },
      { value: "$60,000", label: "Home Buyers' Plan withdrawal limit" },
    ],
    blocks: [
      {
        kind: "text",
        body: "Money you put in an RRSP lowers your taxable income for the year, and it grows without tax while it stays inside. You pay tax when you take it out, usually in retirement when your income (and tax rate) may be lower.",
      },
      {
        kind: "list",
        heading: "Key rules",
        items: [
          "Your room is 18% of last year's earned income, up to the yearly maximum ($33,810 for 2026), plus unused room. It's on your Notice of Assessment.",
          "You need earned income (like a job) to build room, so filing a tax return matters even with a small income.",
          "Withdrawals are taxed and the room doesn't come back (except through the plans below).",
          "You can over-contribute by $2,000 without penalty; beyond that it's 1% a month.",
          "By the end of the year you turn 71, it must become a RRIF or an annuity, or be cashed out.",
        ],
      },
      {
        kind: "table",
        heading: "Borrowing from your RRSP, tax-free",
        columns: ["Plan", "For", "Limit", "Pay back"],
        rows: [
          ["Home Buyers' Plan", "A first home", "$60,000", "Over 15 years"],
          ["Lifelong Learning Plan", "Full-time school", "$10,000/yr, $20,000 total", "Over 10 years"],
        ],
      },
      {
        kind: "tip",
        body: "When your income is low (like as a student), the deduction saves little tax. A TFSA is often more flexible, and you can carry RRSP deductions forward to a higher-income year.",
      },
    ],
    sources: [
      {
        label: "CRA: RRSPs and related plans",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans.html",
      },
      LIMITS,
    ],
    ask: "Does an RRSP or a TFSA make more sense at my income?",
  },
  {
    id: "fhsa",
    category: "registered",
    emoji: "🏡",
    title: "FHSA: First Home Savings Account",
    tagline: "Tax-deductible going in, tax-free coming out for a first home.",
    minutes: 3,
    stats: [
      { value: "$8,000", label: "per year" },
      { value: "$40,000", label: "lifetime limit" },
      { value: "15 yrs", label: "maximum time it can stay open" },
    ],
    blocks: [
      {
        kind: "text",
        body: "The FHSA combines the best of an RRSP and a TFSA for buying a first home: contributions are deductible like an RRSP, and a qualifying withdrawal to buy a home is tax-free like a TFSA.",
      },
      {
        kind: "list",
        heading: "Who can open one",
        items: [
          "Canadian residents 18 or older (19 in some provinces to open an account)",
          "First-time home buyers: you haven't lived in a home you or your spouse owned this year or in the past 4 calendar years",
        ],
      },
      {
        kind: "list",
        heading: "Key rules",
        items: [
          "Room starts the year you open your first FHSA, so opening one early starts the clock on room.",
          "Unused room carries forward, but only up to $8,000 (so the most in one year is $16,000).",
          "It must close after 15 years or by the end of the year you turn 71. Unused money can move to an RRSP without using RRSP room.",
          "You can use the FHSA and the RRSP Home Buyers' Plan for the same home.",
        ],
      },
      { kind: "tip", body: "Even $100 opens the account and starts building room you can use later." },
    ],
    sources: [
      {
        label: "CRA: First Home Savings Account",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account.html",
      },
    ],
  },
  {
    id: "resp",
    category: "registered",
    emoji: "🎓",
    title: "RESP: saving for school, with free money",
    tagline: "The government adds 20% to what's saved for a child's education.",
    minutes: 3,
    stats: [
      { value: "20%", label: "Canada Education Savings Grant match" },
      { value: "$500/yr", label: "basic grant (on $2,500 saved)" },
      { value: "$7,200", label: "lifetime grant per child" },
      { value: "$2,000", label: "Canada Learning Bond (low-income, no saving needed)" },
    ],
    blocks: [
      {
        kind: "text",
        body: "A Registered Education Savings Plan helps a parent, family member, or anyone save for a child's education after high school (university, college, trades). Growth isn't taxed while it's in the plan, and the student pays tax on the grants and growth when withdrawn, often little or none on a student's income.",
      },
      {
        kind: "list",
        heading: "Government money in an RESP",
        items: [
          "Canada Education Savings Grant: 20% of contributions, up to $500 a year, $7,200 lifetime. Missed years can be caught up, up to $1,000 a year.",
          "Lower- and middle-income families get up to $100 more a year on the first $500 saved.",
          "Canada Learning Bond: $500 to start and $100 a year to age 15 (up to $2,000) for low-income families. No contributions needed.",
          "Some provinces add their own grants.",
        ],
      },
      {
        kind: "tip",
        body: "If you were born to a low-income family, you may have Canada Learning Bond money waiting. You can apply for it yourself between ages 18 and 20.",
      },
    ],
    sources: [
      {
        label: "Canada.ca: Canada Education Savings Grant",
        url: "https://www.canada.ca/en/services/benefits/education/education-savings/savings-grant.html",
      },
      {
        label: "Canada.ca: education savings (RESP)",
        url: "https://www.canada.ca/en/services/benefits/education/education-savings.html",
      },
    ],
  },
  {
    id: "rdsp",
    category: "registered",
    emoji: "♿",
    title: "RDSP: Registered Disability Savings Plan",
    tagline: "Up to $90,000 in government grants and bonds over a lifetime.",
    minutes: 2,
    stats: [
      { value: "$3,500/yr", label: "max matching grant" },
      { value: "$1,000/yr", label: "max bond (no saving needed)" },
      { value: "$90,000", label: "lifetime grants and bonds" },
    ],
    blocks: [
      {
        kind: "text",
        body: "An RDSP helps people who qualify for the Disability Tax Credit save for the long term. The government matches contributions with the Canada Disability Savings Grant (up to $3,500 a year, $70,000 lifetime) and adds the Canada Disability Savings Bond for lower incomes (up to $1,000 a year, $20,000 lifetime).",
      },
      {
        kind: "list",
        items: [
          "You need to be eligible for the Disability Tax Credit, under 60, and a Canadian resident with a SIN.",
          "Grants and bonds are paid until the end of the year you turn 49.",
          "Being an RDSP beneficiary can also qualify you for a no-cost bank account.",
        ],
      },
    ],
    sources: [
      {
        label: "Canada.ca: RDSP grants and bonds",
        url: "https://www.canada.ca/en/employment-social-development/programs/disability/savings/how-much.html",
      },
    ],
  },
  {
    id: "compare-accounts",
    category: "registered",
    emoji: "⚖️",
    title: "TFSA vs. RRSP vs. FHSA",
    tagline: "The three big accounts side by side.",
    minutes: 2,
    blocks: [
      {
        kind: "table",
        columns: ["", "TFSA", "RRSP", "FHSA"],
        rows: [
          ["2026 limit", "$7,000", "18% of income, up to $33,810", "$8,000"],
          ["Tax deduction going in", "No", "Yes", "Yes"],
          ["Tax on withdrawals", "None", "Taxed as income", "None, for a first home"],
          ["Room back after withdrawing", "Next January", "No", "No"],
          ["Best for", "Any goal, emergencies", "Retirement", "A first home"],
          ["Age to start", "18", "Any, with earned income", "18 (19 in some provinces)"],
        ],
      },
      {
        kind: "tip",
        body: "A common order of thinking: an emergency fund first, then the account that matches your goal. Your situation decides; this isn't personal advice.",
      },
    ],
    sources: [
      LIMITS,
      {
        label: "CRA: First Home Savings Account",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account.html",
      },
    ],
    ask: "Which of the TFSA, RRSP, and FHSA fits my goals best?",
  },

  // ------------------------------------------------------------------------------------- credit
  {
    id: "credit-score",
    category: "credit",
    emoji: "📈",
    title: "Credit reports and scores",
    tagline: "The number lenders and landlords look at, and how to see yours free.",
    minutes: 4,
    stats: [
      { value: "300–900", label: "credit score range in Canada" },
      { value: "2", label: "credit bureaus: Equifax and TransUnion" },
      { value: "Free", label: "your credit report, from both" },
    ],
    blocks: [
      {
        kind: "text",
        body: "Your credit report is a record of how you've used credit: cards, loans, payments, and missed payments. Your credit score is a number from 300 to 900 based on it. Lenders, landlords, and some employers may check it.",
      },
      {
        kind: "list",
        heading: "What helps your score",
        items: [
          "Paying every bill on time, even just the minimum (payment history matters most).",
          "Using a small part of your limit: keeping balances well below the limit, often under 30%.",
          "A longer credit history, so keep your oldest card open if it's free.",
          "Applying for new credit only when you need it (many applications in a short time can lower your score).",
        ],
      },
      {
        kind: "steps",
        heading: "Check your report",
        items: [
          "Request your free report from Equifax Canada and TransUnion Canada (online or by mail).",
          "Check names, addresses, accounts, and payments for mistakes or accounts you don't recognize.",
          "Dispute errors with the bureau directly; it's free.",
          "Checking your own report doesn't hurt your score.",
        ],
      },
      {
        kind: "warning",
        body: "Accounts you don't recognize can be a sign of identity theft. Contact both bureaus and see Protect yourself.",
      },
    ],
    sources: [
      FCAC,
      { label: "Equifax Canada", url: "https://www.consumer.equifax.ca" },
      { label: "TransUnion Canada", url: "https://www.transunion.ca" },
    ],
    ask: "How can I build my credit score from nothing?",
  },
  {
    id: "credit-cards",
    category: "credit",
    emoji: "💳",
    title: "Credit cards without the debt",
    tagline: "Free to use if you pay in full. Expensive if you don't.",
    minutes: 4,
    stats: [
      { value: "21 days", label: "minimum interest-free grace period on new purchases" },
      { value: "~20%+", label: "typical yearly interest on purchases" },
      { value: "0 days", label: "grace period on cash advances" },
    ],
    blocks: [
      {
        kind: "text",
        body: "Federal rules give you at least 21 days without interest on new purchases when you pay your full balance by the due date. Carry a balance and interest is usually charged from the purchase date, often around 20% a year or more.",
      },
      {
        kind: "list",
        heading: "Habits that keep a card free",
        items: [
          "Pay the full statement balance every month (set up an automatic payment).",
          "Never pay only the minimum unless you have to. Your statement shows how long the minimum would take to pay it off.",
          "Avoid cash advances: interest starts right away, plus a fee.",
          "Treat the limit as a ceiling, not a target.",
          "Quebec residents: the minimum payment is at least 5% of the balance.",
        ],
      },
      {
        kind: "tip",
        body: "The FCAC's Credit Card Payment Calculator shows how long a balance takes to pay off, and how much interest it costs, at different payments.",
      },
    ],
    sources: [
      {
        label: "FCAC Credit Card Payment Calculator",
        url: "https://itools-ioutils.fcac-acfc.gc.ca/CCPC-CPCC/CCPC-CPCC-eng.aspx",
      },
      FCAC,
    ],
    ask: "How long would it take to pay off my card at my current payments?",
  },
  {
    id: "high-cost-loans",
    category: "credit",
    emoji: "🚨",
    title: "Payday and high-cost loans",
    tagline: "The legal limits, and why these loans cost so much.",
    minutes: 3,
    stats: [
      { value: "35%", label: "criminal interest rate cap (APR) since Jan 1, 2025" },
      { value: "$14", label: "max cost per $100 of a payday loan" },
    ],
    blocks: [
      {
        kind: "text",
        body: "Since January 1, 2025, charging more than 35% a year (APR) on most loans is a crime in Canada. Payday loans are an exception in provinces with their own rules, but they're capped at $14 for every $100 borrowed, which is still an annual rate in the hundreds of percent.",
      },
      {
        kind: "table",
        heading: "Borrowing $300 for two weeks",
        columns: ["Option", "About what it costs"],
        rows: [
          ["Payday loan at $14 per $100", "$42"],
          ["Credit card at 20% a year", "About $2 to $3 in interest"],
          ["Overdraft or line of credit", "A few dollars, plus any fee"],
        ],
      },
      {
        kind: "list",
        heading: "Try these first",
        items: [
          "Ask the company you owe for a payment plan or a later due date.",
          "Ask your bank about a small line of credit or overdraft protection.",
          "Talk to a non-profit credit counsellor (it's free or low-cost).",
        ],
      },
      {
        kind: "warning",
        body: "Rolling one payday loan into another is how small debts snowball. Lenders offering loans above the legal limits may be breaking the law.",
      },
    ],
    sources: [
      {
        label: "Canada Gazette: criminal interest rate regulations",
        url: "https://gazette.gc.ca/rp-pr/p2/2025/2025-01-01/html/si-tr4-eng.html",
      },
      FCAC,
    ],
  },
  {
    id: "student-loans",
    category: "credit",
    emoji: "🎒",
    title: "Student loans and grants",
    tagline: "Free grants first, interest-free federal loans, and help paying back.",
    minutes: 4,
    stats: [
      { value: "$4,200", label: "max Canada Student Grant per year (full-time, 2026–27)" },
      { value: "0%", label: "interest on federal student loans" },
      { value: "6 months", label: "after school before you start repaying" },
    ],
    blocks: [
      {
        kind: "text",
        body: "When you apply for student aid through your province or territory, you're also assessed for federal grants and loans. Grants don't have to be paid back; loans do. Federal student loans haven't charged interest since April 1, 2023.",
      },
      {
        kind: "list",
        heading: "What to know",
        items: [
          "The Canada Student Grant for full-time students is up to $4,200 a year in 2026–27, based on family income.",
          "There are extra grants for students with disabilities and students with children.",
          "Your provincial loan may still charge interest, depending on the province.",
          "You don't make payments for 6 months after you leave school.",
          "The Repayment Assistance Plan lowers or pauses payments if your income is low.",
        ],
      },
      {
        kind: "tip",
        body: "Apply every year even if you didn't qualify before: grants depend on income, and rules change.",
      },
    ],
    sources: [
      {
        label: "Canada.ca: student grants and loans",
        url: "https://www.canada.ca/en/services/benefits/education/student-aid/grants-loans.html",
      },
    ],
    ask: "How should I plan to pay back my student loans?",
  },

  // ---------------------------------------------------------------------------------------- tax
  {
    id: "income-tax",
    category: "tax",
    emoji: "🪜",
    title: "How income tax works",
    tagline: "Brackets, your tax-free amount, and why a raise never lowers your pay.",
    minutes: 4,
    stats: [
      { value: "$16,452", label: "2026 basic personal amount (federal)" },
      { value: "14%", label: "lowest federal rate in 2026" },
      { value: "April 30", label: "usual filing deadline" },
    ],
    blocks: [
      {
        kind: "table",
        heading: "2026 federal tax brackets",
        columns: ["Taxable income", "Rate on that part"],
        rows: [
          ["Up to $58,523", "14%"],
          ["$58,523 to $117,045", "20.5%"],
          ["$117,045 to $181,440", "26%"],
          ["$181,440 to $258,482", "29%"],
          ["Over $258,482", "33%"],
        ],
      },
      {
        kind: "text",
        heading: "Only the part in each bracket is taxed at that rate",
        body: "If a raise moves you into a higher bracket, only the dollars above the line are taxed at the higher rate. Your average rate stays much lower than your top (marginal) rate, so a raise always leaves you with more money.",
      },
      {
        kind: "text",
        heading: "The basic personal amount",
        body: "Everyone can earn about $16,452 in 2026 before owing federal income tax, through a non-refundable credit. Provinces have their own brackets and personal amounts, added on top.",
      },
    ],
    sources: [
      {
        label: "CRA: income tax rates for individuals",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html",
      },
    ],
    ask: "Roughly how much tax will I pay on my income?",
  },
  {
    id: "paycheque",
    category: "tax",
    emoji: "💵",
    title: "Reading your paycheque",
    tagline: "Where the money goes between gross and net pay.",
    minutes: 3,
    stats: [
      { value: "5.95%", label: "CPP on earnings from $3,500 to $74,600" },
      { value: "1.63%", label: "EI on earnings up to $68,900" },
      { value: "$18.15", label: "federal minimum wage (from Apr 1, 2026)" },
    ],
    blocks: [
      {
        kind: "table",
        heading: "Common deductions in 2026 (outside Quebec)",
        columns: ["Deduction", "What it is", "2026 rate"],
        rows: [
          ["Income tax", "Federal and provincial tax, withheld based on your TD1 form", "Depends on income"],
          ["CPP", "Canada Pension Plan, for your retirement pension", "5.95% (max $4,230.45)"],
          ["CPP2", "Second tier on earnings $74,600 to $85,000", "4% (max $416)"],
          ["EI", "Employment Insurance, if you lose your job", "1.63% (max $1,123.07)"],
        ],
      },
      {
        kind: "list",
        heading: "Worth knowing",
        items: [
          "Gross pay is before deductions; net pay is what lands in your account.",
          "Your employer also pays CPP and more EI on your behalf.",
          "Quebec has the QPP and a lower EI rate, plus QPIP for parental leave.",
          "The federal minimum wage ($18.15) covers federally regulated jobs; each province sets its own.",
        ],
      },
      {
        kind: "tip",
        body: "Fill out the TD1 form honestly when you start a job. If you work two jobs, ask for more tax to be withheld so you don't owe in April.",
      },
    ],
    sources: [
      {
        label: "CRA: CPP rates and maximums",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html",
      },
      {
        label: "CRA: EI premium rates and maximums",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html",
      },
      {
        label: "Canada.ca: federal minimum wage",
        url: "https://www.canada.ca/en/employment-social-development/news/2026/03/government-of-canada-raises-the-federal-minimum-wage.html",
      },
    ],
  },
  {
    id: "filing",
    category: "tax",
    emoji: "🗂️",
    title: "Filing your taxes (even as a student)",
    tagline: "Filing unlocks benefits, refunds, and RRSP room.",
    minutes: 4,
    blocks: [
      {
        kind: "text",
        body: "You may not owe any tax, but filing a return is how the CRA pays benefits like the Canada Groceries and Essentials Benefit and the Canada Workers Benefit, refunds tax taken off your pay, and records RRSP room and tuition credits.",
      },
      {
        kind: "steps",
        heading: "How to file",
        items: [
          "Gather your slips: T4 (jobs), T2202 (tuition), T5 (interest), and receipts.",
          "Sign up for CRA My Account to see your slips and room online.",
          "File by April 30 using certified tax software (some are free) or a free tax clinic.",
          "Set up direct deposit so refunds and benefits arrive faster.",
        ],
      },
      {
        kind: "list",
        heading: "Student-friendly credits",
        items: [
          "Tuition tax credit: claim your tuition from the T2202 slip. Unused amounts carry forward, or up to $5,000 can be transferred to a parent, grandparent, or spouse.",
          "Interest paid on government student loans can be claimed (carried forward up to 5 years).",
        ],
      },
      {
        kind: "tip",
        body: "Free tax clinics (the Community Volunteer Income Tax Program) file for people with modest income and simple taxes, including many students.",
      },
    ],
    sources: [
      {
        label: "Canada.ca: personal income tax",
        url: "https://www.canada.ca/en/services/taxes/income-tax/personal-income-tax.html",
      },
      {
        label: "CRA: free tax clinics",
        url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/community-volunteer-income-tax-program.html",
      },
    ],
  },
  {
    id: "benefits",
    category: "tax",
    emoji: "🎁",
    title: "Benefits you might be missing",
    tagline: "Government money paid to people with low or modest incomes.",
    minutes: 3,
    stats: [
      { value: "$1,665", label: "max Canada Workers Benefit, single (2026 tax year)" },
      { value: "4×/yr", label: "Groceries and Essentials Benefit payments" },
    ],
    blocks: [
      {
        kind: "list",
        heading: "Federal benefits to know",
        items: [
          "Canada Groceries and Essentials Benefit (formerly the GST/HST credit): tax-free quarterly payments for lower-income people 19 and over. You get it by filing your taxes.",
          "Canada Workers Benefit: a refundable credit for working people with low income, up to $1,665 for a single person for 2026. Part of it can be paid in advance.",
          "Canada Dental Care Plan: dental coverage for people without dental insurance and with family income under $90,000.",
          "Provincial and territorial credits, often paid with the federal ones.",
        ],
      },
      {
        kind: "tip",
        body: "Most of these start automatically once you file a tax return, even if your income was $0.",
      },
    ],
    sources: [
      {
        label: "CRA: Canada Workers Benefit",
        url: "https://www.canada.ca/en/revenue-agency/services/child-family-benefits/canada-workers-benefit.html",
      },
      {
        label: "CRA: GST/HST credit (Groceries and Essentials Benefit)",
        url: "https://www.canada.ca/en/revenue-agency/services/child-family-benefits/goods-services-tax-harmonized-sales-tax-gst-hst-credit.html",
      },
      {
        label: "Canada.ca: Canada Dental Care Plan",
        url: "https://www.canada.ca/en/services/benefits/dental/dental-care-plan.html",
      },
    ],
  },

  // --------------------------------------------------------------------------------------- grow
  {
    id: "budgeting",
    category: "grow",
    emoji: "📊",
    title: "Building a budget that works",
    tagline: "Know where it goes, then decide where it should go.",
    minutes: 3,
    stats: [
      { value: "50/30/20", label: "needs / wants / savings rule of thumb" },
      { value: "1 month", label: "of tracking to see your real spending" },
    ],
    blocks: [
      {
        kind: "steps",
        heading: "Five steps",
        items: [
          "Add up what comes in each month after deductions.",
          "List fixed costs: rent, phone, transit, subscriptions.",
          "Track a month of everyday spending to see the real numbers.",
          "Set a savings amount first (pay yourself first), then limits for the rest.",
          "Check in every payday and adjust; a budget is a plan, not a punishment.",
        ],
      },
      {
        kind: "text",
        heading: "The 50/30/20 rule of thumb",
        body: "About 50% of take-home pay for needs, 30% for wants, and 20% for savings and debt payments. In expensive cities rent can push needs higher; it's a starting point, not a rule.",
      },
      {
        kind: "tip",
        body: "The FCAC has a free online Budget Planner, and Penny's Budgets page does the math for you.",
      },
    ],
    sources: [FCAC],
    ask: "Can you help me set up a budget from my numbers?",
  },
  {
    id: "emergency-fund",
    category: "grow",
    emoji: "🧯",
    title: "Your emergency fund",
    tagline: "The money that turns a crisis into an inconvenience.",
    minutes: 2,
    stats: [{ value: "3–6 months", label: "of essential expenses, a common target" }],
    blocks: [
      {
        kind: "text",
        body: "An emergency fund is money kept aside for surprises: a lost job, a broken phone, a car repair. Without one, surprises often go on a credit card at high interest.",
      },
      {
        kind: "list",
        heading: "How to build one",
        items: [
          "Start with a small target, like $500 or one month of rent.",
          "Keep it separate from spending money, somewhere safe and easy to reach (a high-interest savings account or TFSA).",
          "Save a little every payday automatically.",
          "Refill it after you use it.",
        ],
      },
    ],
    sources: [FCAC],
    ask: "How big should my emergency fund be, and how fast can I build it?",
  },
  {
    id: "investing-basics",
    category: "grow",
    emoji: "📚",
    title: "Investing basics",
    tagline: "Risk, fees, and time, before anyone sells you anything.",
    minutes: 4,
    blocks: [
      {
        kind: "list",
        heading: "Five ideas that matter most",
        items: [
          "Risk and return go together: anything promising high returns with no risk is a red flag.",
          "Diversification: spreading money across many investments lowers the damage from any one.",
          "Fees compound too: a 2% yearly fee on $10,000 is $200 a year, every year.",
          "Time: money invested for longer has more time to recover from drops and to compound.",
          "Inflation: money that earns less than inflation loses buying power.",
        ],
      },
      {
        kind: "table",
        heading: "Common types",
        columns: ["Type", "What it is", "Risk"],
        rows: [
          ["GIC", "A deposit with a guaranteed rate for a set term", "Low (CDIC-insured)"],
          ["Bonds", "Lending to a government or company", "Low to medium"],
          ["Stocks", "Owning a piece of a company", "Higher"],
          ["Mutual funds and ETFs", "Baskets of many investments", "Depends on what's inside"],
        ],
      },
      {
        kind: "warning",
        body: "Before investing with anyone, check they're registered at aretheyregistered.ca. Penny doesn't recommend investments; this is general education.",
      },
    ],
    sources: [
      { label: "Canadian Securities Administrators: check registration", url: "https://www.aretheyregistered.ca" },
      FCAC,
    ],
    ask: "Am I ready to start investing?",
  },

  // ------------------------------------------------------------------------------------ protect
  {
    id: "scams",
    category: "protect",
    emoji: "🎣",
    title: "Spotting scams",
    tagline: "The tricks scammers use on students and young workers.",
    minutes: 3,
    blocks: [
      {
        kind: "list",
        heading: "Common scams",
        items: [
          "Fake CRA or police calls demanding payment by gift cards, crypto, or e-Transfer. The CRA never asks for these.",
          "Job offers that send you a cheque and ask you to send part of it back.",
          "Rentals asking for a deposit before you've seen the place or signed a lease.",
          'Messages with links asking you to "verify" your bank account.',
          "Investment tips promising guaranteed, fast returns.",
        ],
      },
      {
        kind: "steps",
        heading: "If something feels off",
        items: [
          "Stop. Don't send money or share codes, even if they say it's urgent.",
          "Call the organization back using the number on its official website.",
          "Never share a one-time passcode; your bank will never ask for it.",
          "Report it to the Canadian Anti-Fraud Centre and, if you lost money, your bank and the police.",
        ],
      },
    ],
    sources: [{ label: "Canadian Anti-Fraud Centre", url: "https://antifraudcentre-centreantifraude.ca" }],
  },
  {
    id: "complaints",
    category: "protect",
    emoji: "📣",
    title: "Complaints: the 56-day path",
    tagline: "How to escalate a problem with a bank, step by step.",
    minutes: 2,
    stats: [
      { value: "56 days", label: "for a bank to resolve your complaint" },
      { value: "Free", label: "OBSI, the independent complaints body" },
    ],
    blocks: [
      {
        kind: "steps",
        items: [
          "Complain to your bank first, in writing if you can, and keep notes.",
          "The bank has up to 56 days to give you a final written answer.",
          "Not satisfied, or no answer after 56 days? Take it to the Ombudsman for Banking Services and Investments (OBSI) within 180 days.",
          "OBSI reviews it for free and can recommend the bank compensate you.",
          "You can also report a bank breaking consumer rules to the FCAC.",
        ],
      },
      {
        kind: "tip",
        body: "Credit unions and investment firms have their own timelines (often 90 days). Their complaint page will say.",
      },
    ],
    sources: [
      { label: "Ombudsman for Banking Services and Investments", url: "https://www.obsi.ca" },
      {
        label: "FCAC: file a complaint",
        url: "https://www.canada.ca/en/financial-consumer-agency/services/complaints/file-complaint-financial-institution.html",
      },
    ],
  },
];

/** A Fact Blitz question: three options, one right, and why. */
export type QuizItem = { q: string; options: [string, string, string]; answer: 0 | 1 | 2; why: string };

/** Each guide plays as a quick game first; the full text is there to dig deeper. */
export const QUIZZES: Record<string, QuizItem[]> = {
  "chequing-savings": [
    {
      q: "Which account is built for everyday spending?",
      options: ["Savings", "Chequing", "A GIC"],
      answer: 1,
      why: "Chequing is for debit, bills, and e-Transfers; savings is for setting money aside.",
    },
    {
      q: "A GIC gives you a guaranteed rate in exchange for…",
      options: ["Locking money for a set term", "A monthly fee", "Your credit score"],
      answer: 0,
      why: "You agree to leave the money in for a term, like 1 year.",
    },
  ],
  "low-cost-accounts": [
    {
      q: "The most a low-cost chequing account at a big bank can charge per month:",
      options: ["$4", "$10", "$15"],
      answer: 0,
      why: "14 banks committed to low-cost accounts of no more than $4 a month.",
    },
    {
      q: "To open a bank account in Canada, you need…",
      options: ["A job", "A minimum deposit", "Acceptable ID"],
      answer: 2,
      why: "Federal rules let you open an account without a job or deposit, with ID.",
    },
  ],
  "deposit-insurance": [
    {
      q: "CDIC protects eligible deposits up to…",
      options: ["$10,000", "$100,000 per category", "Any amount"],
      answer: 1,
      why: "Up to $100,000 per category, per member bank, including interest.",
    },
    {
      q: "Which one is NOT covered by CDIC?",
      options: ["A savings account", "A GIC", "ETFs"],
      answer: 2,
      why: "Investments like ETFs and stocks aren't deposits.",
    },
  ],
  "banking-rights": [
    {
      q: "How long does a bank have to resolve your complaint?",
      options: ["7 days", "56 days", "1 year"],
      answer: 1,
      why: "Federally regulated banks have up to 56 days to give a final answer.",
    },
    {
      q: "Can a bank make you buy a product to get the one you asked for?",
      options: ["Yes, it's normal", "No, that's coercive tied selling", "Only for loans"],
      answer: 1,
      why: "Pressuring you into unwanted products isn't allowed.",
    },
  ],
  tfsa: [
    {
      q: "New TFSA room for 2026:",
      options: ["$5,000", "$7,000", "$10,000"],
      answer: 1,
      why: "The 2026 TFSA dollar limit is $7,000.",
    },
    {
      q: "Tax on money you withdraw from a TFSA:",
      options: ["None", "Your tax rate", "15%"],
      answer: 0,
      why: "Growth and withdrawals are tax-free.",
    },
  ],
  rrsp: [
    {
      q: "What does an RRSP contribution do to your taxes this year?",
      options: ["Nothing", "Lowers your taxable income", "Raises them"],
      answer: 1,
      why: "Contributions are deductible; you pay tax when you withdraw.",
    },
    {
      q: "The 2026 RRSP maximum is…",
      options: ["$7,000", "$33,810", "No limit"],
      answer: 1,
      why: "18% of last year's earned income, up to $33,810 for 2026.",
    },
  ],
  fhsa: [
    {
      q: "FHSA lifetime limit:",
      options: ["$8,000", "$40,000", "$100,000"],
      answer: 1,
      why: "$8,000 a year, up to $40,000 in total.",
    },
    {
      q: "The FHSA is for…",
      options: ["Retirement", "A first home", "School"],
      answer: 1,
      why: "Deductible going in, tax-free coming out for a qualifying first home.",
    },
  ],
  resp: [
    {
      q: "How much does the Canada Education Savings Grant add?",
      options: ["5%", "20%", "50%"],
      answer: 1,
      why: "20% of contributions, up to $500 a year and $7,200 per child.",
    },
    {
      q: "The Canada Learning Bond needs how much saved by the family?",
      options: ["$0", "$500", "$2,500"],
      answer: 0,
      why: "It's for low-income families and needs no contributions.",
    },
  ],
  rdsp: [
    {
      q: "Lifetime government grants and bonds in an RDSP can reach…",
      options: ["$9,000", "$90,000", "$900,000"],
      answer: 1,
      why: "Up to $70,000 in grants plus $20,000 in bonds.",
    },
    {
      q: "To open an RDSP you need to qualify for…",
      options: ["The Disability Tax Credit", "A mortgage", "A student loan"],
      answer: 0,
      why: "Eligibility for the Disability Tax Credit is required.",
    },
  ],
  "compare-accounts": [
    {
      q: "Which account gives room back the next January after you withdraw?",
      options: ["TFSA", "RRSP", "FHSA"],
      answer: 0,
      why: "Only TFSA withdrawals are added back to your room.",
    },
    {
      q: "Which one taxes withdrawals as income?",
      options: ["TFSA", "RRSP", "FHSA (for a first home)"],
      answer: 1,
      why: "RRSP withdrawals are taxed as income.",
    },
  ],
  "credit-score": [
    {
      q: "Credit scores in Canada range from…",
      options: ["0 to 100", "300 to 900", "500 to 1,000"],
      answer: 1,
      why: "Scores run from 300 to 900.",
    },
    {
      q: "Does checking your own credit report lower your score?",
      options: ["Yes", "No", "Only once a year"],
      answer: 1,
      why: "Checking your own report doesn't affect your score.",
    },
  ],
  "credit-cards": [
    {
      q: "Minimum interest-free grace period on new purchases if you pay in full:",
      options: ["None", "21 days", "90 days"],
      answer: 1,
      why: "Federal rules give at least 21 days.",
    },
    {
      q: "When does interest start on a cash advance?",
      options: ["Right away", "After 21 days", "Next month"],
      answer: 0,
      why: "Cash advances have no grace period, and often a fee.",
    },
  ],
  "high-cost-loans": [
    {
      q: "Canada's criminal interest rate cap (since 2025):",
      options: ["15% APR", "35% APR", "60% APR"],
      answer: 1,
      why: "Charging over 35% APR on most loans is a crime.",
    },
    {
      q: "Most a payday loan can cost per $100 borrowed:",
      options: ["$1", "$14", "$35"],
      answer: 1,
      why: "$14 per $100, which is still hundreds of percent a year.",
    },
  ],
  "student-loans": [
    {
      q: "Interest on federal student loans:",
      options: ["0%", "Prime + 2%", "10%"],
      answer: 0,
      why: "Federal student loans haven't charged interest since April 2023.",
    },
    {
      q: "How long after school before repayment starts?",
      options: ["Right away", "6 months", "5 years"],
      answer: 1,
      why: "There's a 6-month period with no payments.",
    },
  ],
  "income-tax": [
    {
      q: "A raise pushes you into a higher bracket. Your take-home pay…",
      options: ["Goes down", "Still goes up", "Stays the same"],
      answer: 1,
      why: "Only the dollars above the line get the higher rate.",
    },
    {
      q: "The lowest federal tax rate in 2026:",
      options: ["10%", "14%", "20.5%"],
      answer: 1,
      why: "14% on the first $58,523 of taxable income.",
    },
  ],
  paycheque: [
    {
      q: "What does CPP on your paycheque pay for?",
      options: ["Your retirement pension", "Health care", "Your student loan"],
      answer: 0,
      why: "The Canada Pension Plan builds your retirement pension.",
    },
    {
      q: "The federal minimum wage from April 1, 2026:",
      options: ["$15.00", "$18.15", "$21.00"],
      answer: 1,
      why: "$18.15 an hour for federally regulated jobs; provinces set their own.",
    },
  ],
  filing: [
    {
      q: "Your income was tiny this year. Should you file taxes?",
      options: ["No point", "Yes, to get benefits and refunds", "Only if you owe"],
      answer: 1,
      why: "Filing unlocks benefits and records RRSP room and tuition credits.",
    },
    {
      q: "The slip that shows your tuition:",
      options: ["T4", "T2202", "T5"],
      answer: 1,
      why: "Your school issues the T2202 for the tuition credit.",
    },
  ],
  benefits: [
    {
      q: "The GST/HST credit is now called…",
      options: ["Canada Groceries and Essentials Benefit", "Canada Child Benefit", "Carbon rebate"],
      answer: 0,
      why: "It was renamed in 2026 and is still paid quarterly.",
    },
    {
      q: "How do most benefits start?",
      options: ["Applying in person", "Filing your tax return", "Asking your bank"],
      answer: 1,
      why: "Most start automatically once you file.",
    },
  ],
  budgeting: [
    {
      q: "In 50/30/20, the 30 is for…",
      options: ["Needs", "Wants", "Savings"],
      answer: 1,
      why: "About 50% needs, 30% wants, 20% savings and debt.",
    },
    {
      q: '"Pay yourself first" means…',
      options: ["Treat yourself on payday", "Save before you spend", "Pay rent first"],
      answer: 1,
      why: "Set savings aside first, then spend what's left.",
    },
  ],
  "emergency-fund": [
    {
      q: "A common emergency fund target:",
      options: ["One week", "3–6 months of essentials", "Two years of pay"],
      answer: 1,
      why: "3 to 6 months of essential expenses, built over time.",
    },
    {
      q: "Where's a good place to keep it?",
      options: ["In stocks", "A high-interest savings account", "Your wallet"],
      answer: 1,
      why: "Safe and easy to reach, like a HISA or a TFSA.",
    },
  ],
  "investing-basics": [
    {
      q: "A 2% yearly fee on $10,000 costs about…",
      options: ["$2", "$20", "$200 a year"],
      answer: 2,
      why: "2% of $10,000 is $200, every year.",
    },
    {
      q: '"High returns with no risk" is…',
      options: ["A great deal", "A red flag", "Normal"],
      answer: 1,
      why: "Risk and return go together; that promise is a warning sign.",
    },
  ],
  scams: [
    {
      q: "The CRA asks you to pay in gift cards. It's…",
      options: ["Real if urgent", "Always a scam", "Real for small amounts"],
      answer: 1,
      why: "The CRA never takes gift cards, crypto, or e-Transfers.",
    },
    {
      q: "Your bank texts asking for your one-time passcode. You…",
      options: ["Send it", "Never share it", "Share half"],
      answer: 1,
      why: "Banks never ask for your passcode.",
    },
  ],
  complaints: [
    {
      q: "Where do bank complaints go after 56 days?",
      options: ["OBSI", "The police", "Your MP"],
      answer: 0,
      why: "The Ombudsman for Banking Services and Investments, for free.",
    },
    {
      q: "What does OBSI cost you?",
      options: ["$50", "$0", "A percentage of the claim"],
      answer: 1,
      why: "It's free for consumers.",
    },
  ],
};
