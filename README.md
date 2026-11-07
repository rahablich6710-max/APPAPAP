# Scan & Review

A QR code review tool for small businesses. Customers scan, rate, and get a reward code. Owners get a dashboard with a printable QR, a reviews explorer (filter by star rating or complaint reason, sort, open any review), an automatic low-rating summary, a reward redeem screen, and settings. No dependencies to install.

## Easiest way online: Render (about 10 minutes)

1. Make a free GitHub account, create a new repository, and upload every file in this folder (Add file, then Upload files).
2. Make an account at render.com. Click New, then Blueprint, and pick your repository. Render reads `render.yaml` and sets up the server, the permanent storage disk, and the settings for you.
3. Approve the plan. The Starter plan is needed because it supports a disk. Check Render's current pricing.
4. When it finishes, open the address Render gives you. Enter your business name and click "Create my QR code".
5. Bookmark the dashboard page that opens. That link is your login.
6. In Settings, paste your Google review link (https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID, use Google's Place ID Finder).
7. Click Print table tent, then scan the printed code with a phone to test it.

Create your business on the live address, not on localhost, so the QR points to the public site.

## Try it on your own computer first (optional)

Install Node.js 18+, run `node server.js` in this folder, and open http://localhost:3000.

## How a business uses it

- Dashboard: ratings, average, sent to Google, rewards issued and redeemed, private notes.
- Low-rating summary: ranks the top complaints from 3 star and below feedback and suggests what to fix first. It is generated from the reasons customers tap and times they mention (like "25 minutes"), not by an AI model.
- Customer reviews: filter by star rating or reason, sort, and open any review for the full text.
- Redeem: staff type the customer's code (like THX-AB12). A code works once.

## Review policy note

Google and Yelp prohibit giving rewards in exchange for reviews. This app gives the reward to every customer who finishes the flow, and the Google step never mentions it. Keep your signs and staff wording the same: do not say "leave a review to get a discount." Check current Google and Yelp policies before selling this.

## Not included yet

- Accounts and passwords (the secret dashboard link is the login).
- Billing (add Stripe if you want to charge shops).
- A real database (data lives in one JSON file, fine for dozens of businesses).
- Proof that someone posted on Google. The app only knows they tapped through.
- Vercel hosting. This is a normal always-on server, so use Render, Railway, or Fly.io.
