import minimist from 'minimist';
import prompt from 'prompt-sync';
import fetch from 'node-fetch';
import ora from 'ora';
import Coub from 'coub-dl';
import { PromisePool } from '@supercharge/promise-pool';
import * as path from 'path';
import * as fs from 'fs';

const argv = minimist(process.argv.slice(2));
const input = prompt();

const config = {
    user: argv.user || input('Username: '),
    outDir: argv.outDir || input('Output directory: ') || './coubs'
};

if (!config.user) {
    console.error('Error: No username is given.');
    process.exit(-1);
}

if (!config.outDir) {
    console.error('Error: No output directory is given.');
    process.exit(-2);
}

let currentPage = 1;
let perPage;
let totalPages;
const coubs = [];

let successfulDownloadCount = 0;
const failedDownloads = [];

(async () => {
    //load coub metadata
    try {
        const metadataSpinner = ora('Loading metadata ...').start();
        const response = await fetch(`https://coub.com/api/v2/timeline/channel/${encodeURIComponent(config.user)}?order_by=newest&type=simples&scope=all&page=${currentPage}&per_page=25`);
        if (!response.ok) {
            console.error('Can not load metadata of coubs. User is not exists or an unknown error is happened.');
            process.exit(-3);
        }

        const metadata = await response.json();
        totalPages = metadata.total_pages;
        perPage = metadata.perPage;

        coubs.push(...metadata.coubs);

        for (currentPage++; currentPage <= totalPages; currentPage++) {
            metadataSpinner.text = `Loading metadata ... (${currentPage}/${totalPages})`;
            const res = await fetch(`https://coub.com/api/v2/timeline/channel/${encodeURIComponent(config.user)}?order_by=newest&type=simples&scope=all&page=${currentPage}&per_page=25`);
            if (!response.ok) {
                console.error(`Can not load metadata of coubs (${currentPage}/${totalPages})`);
                process.exit(-4);
            }

            const data = await res.json();
            coubs.push(...data.coubs);
        }

        const filepath = path.join(config.outDir, '.metadata.json');

        if (!fs.existsSync(filepath)) {
            fs.writeFileSync(filepath, JSON.stringify(coubs), { encoding: 'utf8' });
        }

        metadataSpinner.stopAndPersist({ symbol: '✓', text: `Metadata of ${coubs.length} coubs are loaded.` });
    } catch (err) {
        console.error(err);
        process.exit(-4);
    }

    // download coubs
    try {
        const downloadSpinner = ora('Downloading coubs ...').start();

        const { errors } = await PromisePool.for(coubs)
            .withConcurrency(3)
            .process(async metadata => {
                const date = Math.round(new Date(metadata.created_at).getTime() / 1000);
                const filepath = path.join(config.outDir, `${date}.mp4`);

                if (fs.existsSync(filepath)) {
                    successfulDownloadCount++;
                    downloadSpinner.text = `Downloading coubs ... (${successfulDownloadCount}/${coubs.length})`;
                    return;
                }

                const coub = await Coub.fetch(`https://coub.com/view/${encodeURIComponent(metadata.permalink)}`);

                if (coub.audio) {
                    coub.attachAudio();
                    coub.loop(999);
                    coub.addOption('-shortest');
                } else {
                    coub.loop(1);
                }
                
                coub.setPath('./bin/ffmpeg.exe');

                try {
                    await coub.write(filepath);
                    successfulDownloadCount++;
                    downloadSpinner.text = `Downloading coubs ... (${successfulDownloadCount}/${coubs.length})`;
                } catch (err) {
                    console.error(err);
                    failedDownloads.push(metadata);
                }
            });

        console.log(errors);
        downloadSpinner.stopAndPersist({ symbol: '✓', text: `${successfulDownloadCount} coubs are downloaded.` });
    } catch (err) {
        console.error(err);
    }
})();
