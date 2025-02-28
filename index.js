// Node.js Charity Navigator Scraper for Vercel using Puppeteer and Hunter.io API
// This script scrapes organization data (Company Name, Website) from Charity Navigator,
// enriches it with known email addresses using Hunter.io API, and serves results via API.

const puppeteer = require('puppeteer-core');
const chrome = require('chrome-aws-lambda');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY || '6efff6934c69e6bd62c67d2a942436c0424aa885';

async function launchBrowser() {
    return await puppeteer.launch({
        args: chrome.args,
        executablePath: await chrome.executablePath,
        headless: chrome.headless,
    });
}

app.get('/scrape', async (req, res) => {
    try {
        const browser = await launchBrowser();
        const page = await browser.newPage();

        let allOrganizations = [];
        const maxPages = 3;

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            console.log(`Scraping page ${pageNum}...`);
            await page.goto(`https://www.charitynavigator.org/search?q=&page=${pageNum}&pageSize=10`, {
                waitUntil: 'domcontentloaded',
            });

            const organizations = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a[href^="/ein/"]')).map(link => ({
                    name: link.innerText.trim(),
                    profileUrl: `https://www.charitynavigator.org${link.getAttribute('href')}`,
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
        }

        await browser.close();
        res.json(allOrganizations);
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;