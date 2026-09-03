# How to get Claude to explain ApproveX to you (super simple)

This page gives you a ready-made message ("a prompt") to send to Claude. Claude will then explain
your whole app in plain English so you can **show it to customers**, **run it on your own laptop**,
and **put it online for almost no money**.

You don't need to be technical. Just follow the 3 steps.

---

## Step 1 — Open Claude

Use whichever you have:
- **Claude Code** opened inside this project folder (best — Claude can read the real files), **or**
- **claude.ai** in your web browser (also fine).

## Step 2 — Copy the message below

Copy **everything** inside the grey box. Don't change anything.

## Step 3 — Paste it and press send

Claude will write you one clear guide. Read it, and you're done. If anything is unclear, just
reply "explain that part more simply" and it will.

---

## 👇 The message to copy

```text
I am not technical. Please explain my app "ApproveX" to me in very simple, everyday language —
like you're explaining it to a smart friend who has never coded. Avoid jargon; when you must use a
technical word, explain it in a few plain words right after. Use short sentences, headings, and
step-by-step lists. Read the project files first (README.md, CLAUDE.md, and the docs/ folder) so
everything you tell me is true to my actual app.

Quick background so you know what my app is:
ApproveX is "approvals as an API." In plain words: when a company's software is about to do
something that needs a yes/no — like paying a big invoice — it quietly asks ApproveX first.
ApproveX checks the company's own rules (e.g. "payments over 5 lakh need Finance to approve"),
sends it to the right people to approve, and keeps a permanent record of who approved what and
when. Finance staff set the rules themselves with clicks — no coding.

Please write me ONE simple guide with these 5 parts:

PART 1 — What is this app, in plain words?
- Explain what problem it solves, using a real everyday example (like approving a big payment).
- Explain why a company would want it, in 3 short bullet points.
- Tell me what kind of businesses should buy it and which use to start with.

PART 2 — How does it work? (explain it like I'm 12)
- Walk me through what happens step by step, from "a payment needs approval" to "everyone gets
  notified and it's recorded." Number the steps.
- Draw a simple arrow diagram I can show on a slide, like: request -> check the rules -> ask the
  approvers -> notify the company's system -> save a permanent record.
- Explain in one plain sentence each why it's trustworthy (nobody can fake or delete the records,
  people can't approve their own requests, each company's data is kept separate).

PART 3 — How do I show it off to a customer? (a 90-second demo)
- Give me the exact clicks to do in order, and the exact sentence to SAY at each click.
- Keep it to about 6 steps so I can memorize it.

PART 4 — How do I run it on my own laptop?
- Give me the exact commands to copy and paste, one block at a time, IN ORDER.
- Before the commands, list what I need to install first, with a one-line "why" for each.
- After each command block, tell me what I should see if it worked, and what to do if it didn't.
- Tell me the exact web address to open in my browser to see the app.
- Give me the easiest path first (the one with the fewest steps).

PART 5 — How do I put it online for almost no money?
- Explain the cheapest way to get it live on the internet, in simple steps.
- Make a small table showing what is FREE and what I have to pay for, with rough monthly cost.
- Tell me plainly: what's the one thing worth paying a little extra for on day one, and why.
- Explain in one line what makes the cost go up later (so I'm not surprised).

Rules for how you write it:
- Assume I know nothing. Explain every step.
- Never show a command without telling me what it does and what I'll see after.
- Use tables and short bullets, not long paragraphs.
- If anything in my background summary above is wrong compared to the real files, trust the files
  and gently tell me what's actually true.
- At the very end, give me a 5-line "cheat sheet" I can glance at before talking to a customer.
```

---

## That's it

- Want a version aimed at **one specific audience** (say, a non-technical business owner vs. a
  developer)? Tell me and I'll make a second copy-paste message.
- Want an even shorter **"one-paragraph pitch"** message for quick emails or WhatsApp? Just ask.

> Good to know: most of what Claude will tell you already lives in your project's `docs/` folder —
> `docs/PRODUCT.md` (the sales pitch), `docs/SETUP.md` (running it on your laptop), and
> `docs/DEPLOYMENT.md` (putting it online, with real cost numbers). The message above just gets
> Claude to turn all of that into one simple, friendly guide for you.
