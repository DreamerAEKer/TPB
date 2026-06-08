import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Replace with the path to your artifact directory. We will pass it via args.
const artifactDir = process.argv[2] || __dirname;

async function runTests() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ 
        headless: 'new',
        defaultViewport: { width: 1366, height: 768 }
    });
    
    const page = await browser.newPage();
    
    console.log('Navigating to http://localhost:5173 ...');
    try {
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 10000 });
    } catch (err) {
        console.error('Failed to load dev server:', err.message);
        process.exit(1);
    }

    // Wait a bit for JS to initialize
    await new Promise(r => setTimeout(r, 2000));

    console.log('Creating 235 mixed items via page.evaluate...');
    await page.evaluate(() => {
        const mixedShipments = [];
        for(let i=0; i<235; i++) {
            // Randomly assign services
            const isRemote = Math.random() > 0.8;
            const hasInsurance = Math.random() > 0.8;
            const hasAr = Math.random() > 0.8;
            const isJumbo = Math.random() > 0.95;
            
            const weight = Math.floor(Math.random() * 5000) + 100; // 100g to 5kg
            let fee = 50 + (isRemote ? 20 : 0) + (hasInsurance ? 25 : 0) + (hasAr ? 12 : 0);
            
            mixedShipments.push({
                serviceType: 'EMS',
                prefix: 'EJ',
                digits: String(12340001 + i).padStart(8, '0'),
                trackingFormatted: `EJ${String(12340001 + i).padStart(8, '0')}TH`,
                recipient: `ลูกค้าทดสอบคนที่ ${i+1}`,
                destination: isRemote ? '20120' : '10200',
                weight: weight.toString(),
                fee: fee.toString(),
                options: {
                    optAr: hasAr,
                    optInsurance: hasInsurance,
                    insuranceVal: hasInsurance ? "5000" : "",
                    isRemoteCheck: isRemote,
                    isJumbo: isJumbo
                },
                isOrdinaryBulk: false
            });
        }
        window.shipments.push(...mixedShipments);
        window.renderShipments();
        window.updateSummary();
    });

    await new Promise(r => setTimeout(r, 1000));
    console.log('Capturing: 01_235_mixed_items.png');
    await page.screenshot({ path: path.join(artifactDir, '01_235_mixed_items.png'), fullPage: true });

    // Mock window.print to prevent freeze
    await page.evaluate(() => { window.print = () => console.log('Mock print'); });

    // Click Dispatch
    console.log('Clicking Dispatch...');
    await page.click('#dispatch-btn');
    // Wait for animation and print dialog (the app calls window.print(), which halts puppeteer in headful, but headless it resolves)
    // Wait for the printable view to be visible (usually the view changes or modal appears)
    await new Promise(r => setTimeout(r, 2000));
    console.log('Capturing: 02_dispatch_summary.png');
    await page.screenshot({ path: path.join(artifactDir, '02_dispatch_summary.png'), fullPage: false });

    // Try to click "Save to Archive" or whatever button appears to confirm dispatch
    // We need to look at how dispatch works. It usually transitions to a print view or archive view.
    // In Thai Post Bill, `#view-dashboard` is hidden, `#view-archive` is shown or print layout is used.
    // Let's navigate to the archive tab explicitly to see the saved history.
    console.log('Navigating to Archive...');
    await page.click('#nav-archive');
    await new Promise(r => setTimeout(r, 2000));
    console.log('Capturing: 03_archive_history.png');
    await page.screenshot({ path: path.join(artifactDir, '03_archive_history.png'), fullPage: false });

    console.log('Testing complete. Closing browser.');
    await browser.close();
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
