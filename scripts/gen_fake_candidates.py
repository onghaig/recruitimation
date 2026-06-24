#!/usr/bin/env python3
"""Generate fake mailroom-clerk candidate resumes for testing batch ingest.

Procedural (no LLM). Each file mimics the Indeed resume text layout so the
backend parse + backfillContact extract name/email/phone/location reliably.
Run: python3 scripts/gen_fake_candidates.py [count] [outdir]
"""
import os, sys, random

random.seed(42)
COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 100
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else "fake_candidates"

FIRST = ("James Maria Robert Linda Michael Patricia David Jennifer Carlos Aisha "
         "Tyrone Mei Jose Sandra Kevin Brenda Marcus Latoya Hassan Olga Devin "
         "Priya Andre Nicole Samuel Tanya Luis Crystal Darnell Yolanda").split()
LAST = ("Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez "
        "Hernandez Lopez Gonzalez Wilson Anderson Thomas Taylor Moore Jackson Martin "
        "Lee Perez Thompson White Harris Sanchez Clark Lewis Robinson Walker").split()
CITIES = [("Albany","NY","12210"),("Troy","NY","12180"),("Schenectady","NY","12305"),
          ("Rensselaer","NY","12144"),("Clifton Park","NY","12065"),("Latham","NY","12110"),
          ("Cohoes","NY","12047"),("Watervliet","NY","12189"),("Menands","NY","12204"),
          ("Colonie","NY","12205")]
MAIL = ["Mailroom Clerk","Mail Sorter","Mail Processing Clerk","Shipping and Receiving Clerk",
        "Distribution Clerk","Mail Services Associate"]
RELATED = ["Warehouse Associate","Package Handler","Courier Driver","Office Clerk",
           "Data Entry Clerk","Front Desk Associate","Inventory Associate"]
UNRELATED = ["Line Cook","Housekeeper","Retail Cashier","Security Guard","Landscaper",
             "Server","Home Health Aide"]
EMPLOYERS = ["FedEx Office","UPS Store","Pitney Bowes","Iron Mountain","Staples","Office Depot",
             "Ricoh USA","Canon Business Services","USPS contractor","Williams Lea","Novitex",
             "ABC Logistics","Capital Region Mailing","Empire State Plaza"]
MAIL_SKILLS = ["mail sorting","package scanning","Pitney Bowes postage meter","FedEx Ship Manager",
               "UPS WorldShip","metered mail","sorting by ZIP code","inbound/outbound logging",
               "Xerox copiers","data entry","inventory tracking","forklift certified",
               "10-key","records management","courier dispatch","multi-line phone"]
DOMAINS = ["gmail.com","yahoo.com","outlook.com","aol.com"]
DUTIES = [
    "Sorted and distributed up to 500 pieces of incoming mail daily.",
    "Operated postage meter and prepared outgoing certified and priority mail.",
    "Logged and scanned inbound packages and notified recipients.",
    "Maintained mailroom supplies and metered-mail accounts.",
    "Processed interoffice deliveries across a multi-floor office.",
    "Reconciled shipping manifests and tracked discrepancies.",
]

def phone():
    return f"+1 {random.randint(518,518)} {random.randint(200,989)} {random.randint(1000,9999)}"

def email(f, l):
    return f"{f.lower()}{l.lower()[0]}{random.randint(1,99)}@{random.choice(DOMAINS)}"

def job_block(title, idx):
    emp = random.choice(EMPLOYERS)
    end_year = 2026 - idx * random.randint(1, 3)
    start_year = end_year - random.randint(1, 5)
    end = "Present" if idx == 0 and random.random() < 0.5 else f"{random.choice(['Jan','Mar','Jun','Sep'])} {end_year}"
    start = f"{random.choice(['Jan','Mar','Jun','Sep'])} {start_year}"
    bullets = "\n".join(f"- {d}" for d in random.sample(DUTIES, k=2))
    return f"{title} - {emp}\n{start} to {end}\n{bullets}", (end_year - start_year)

def make_resume():
    f, l = random.choice(FIRST), random.choice(LAST)
    city, st, zp = random.choice(CITIES)
    # 60% strong mailroom fit, 25% related, 15% unrelated -> score variety
    r = random.random()
    if r < 0.60:
        titles = [random.choice(MAIL)] + random.sample(MAIL + RELATED, k=random.randint(0, 2))
        field = "mailroom and mail processing"
    elif r < 0.85:
        titles = [random.choice(RELATED)] + random.sample(RELATED + MAIL, k=random.randint(0, 1))
        field = "warehouse and clerical support"
    else:
        titles = [random.choice(UNRELATED)] + random.sample(UNRELATED, k=random.randint(0, 1))
        field = "general labor and service work"
    jobs, total_yrs = [], 0
    for i, t in enumerate(titles):
        block, yrs = job_block(t, i)
        jobs.append(block)
        total_yrs += yrs
    skills = ", ".join(random.sample(MAIL_SKILLS, k=random.randint(4, 7)))
    return f"""Contact information
Full name
{f} {l}
Email
{email(f, l)}
Phone number
{phone()}
City, state
{city}, {st} {zp}

Summary
{max(total_yrs,1)} years of experience in {field}.

Experience
{chr(10).join(jobs)}

Skills
{skills}

Education
High school diploma
"""

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    for i in range(1, COUNT + 1):
        with open(os.path.join(OUTDIR, f"candidate_{i:03d}.txt"), "w") as fh:
            fh.write(make_resume())
    print(f"Wrote {COUNT} resumes to {OUTDIR}/")

if __name__ == "__main__":
    main()
