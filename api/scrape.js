// Full Stack Charity Navigator Scraper - Frontend + API
// This will create a front-end page that shows:
// - The URL being scraped
// - Where the data is being saved
// - A button to start scraping
// - A section to display results

const express = require('express');
const puppeteer = require('puppeteer-core');
const chrome = require('chrome-aws-lambda');
const axios = require('axios');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cors = require('cors');
require('dotenv').config();

const app = express();
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

app.use(cors());

async function launchBrowser() {
    return await puppeteer.launch({
        args: chrome.args,
        executablePath: await chrome.executablePath,
        headless: chrome.headless,
    });
}

app.get('/api/scrape', async (req, res) => {
    try {
        const browser = await launchBrowser();
        const page = await browser.newPage();
        let allOrganizations = [];
        
        console.log(`Scraping from: https://www.charitynavigator.org/search`);
        await page.goto(`https://www.charitynavigator.org/search?q=&page=1&pageSize=10`, { waitUntil: 'domcontentloaded' });

        const organizations = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href^="/ein/"]')).map(link => ({
                name: link.innerText.trim(),
                profileUrl: `https://www.charitynavigator.org${link.getAttribute('href')}`
            }));
        });
        
        for (let org of organizations) {
            console.log(`Fetching profile: ${org.name} - ${org.profileUrl}`);
            await page.goto(org.profileUrl, { waitUntil: 'domcontentloaded' });
            
            const website = await page.evaluate(() => {
                const link = document.querySelector('a[href^="http"]');
                return link ? link.href : null;
            });
            
            const email = website ? await fetchHunterData(website) : 'Not found';
            allOrganizations.push({ name: org.name, website: website || 'Not found', email });
        }
        
        await browser.close();
        await saveToGoogleSheet(allOrganizations);
        res.json({ scrapedFrom: 'https://www.charitynavigator.org/search', savedAt: 'Google Sheets', data: allOrganizations });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

async function fetchHunterData(website) {
    try {
        const domain = new URL(website).hostname;
        const response = await axios.get(`https://api.hunter.io/v2/domain-search`, {
            params: { domain, api_key: HUNTER_API_KEY },
        });
        return response.data.data?.emails?.[0]?.value || 'Not found';
    } catch (error) {
        console.error(`Hunter.io API error for ${website}: ${error.message}`);
        return 'Not found';
    }
}

async function saveToGoogleSheet(data) {
    try {
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
        await doc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRows(data);
        console.log('Data saved to Google Sheets');
    } catch (error) {
        console.error('Error saving to Google Sheets:', error.message);
    }
}

app.listen(3001, () => console.log(`API running on http://localhost:3001`));

const frontendHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Charity Navigator Scraper</title>
    <script>
        async function startScraping() {
            document.getElementById('status').innerText = 'Scraping... Please wait';
            const response = await fetch('/api/scrape');
            const data = await response.json();
            document.getElementById('status').innerText = 'Scraping Completed';
            document.getElementById('url').innerText = 'Scraped From: ' + data.scrapedFrom;
            document.getElementById('storage').innerText = 'Data Saved At: Google Sheets';
            document.getElementById('results').innerHTML = JSON.stringify(data.data, null, 2);
        }
    </script>
</head>
<body>
    <h1>Charity Navigator Scraper</h1>
    <button onclick="startScraping()">Start Scraping</button>
    <p id="status">Click the button to start scraping.</p>
    <p id="url"></p>
    <p id="storage"></p>
    <pre id="results"></pre>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(frontendHtml);
});

module.exports = app;