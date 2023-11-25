import fs from 'fs';
import fsPromise from 'fs/promises';
import axios from 'axios';  // used to make http requests
import axiosRetry from 'axios-retry';
import prompt from 'prompt-sync'; // used to get user inputs
import { exec } from 'child_process';
import cliProgress from 'cli-progress'; // Install this library using: npm install cli-progress
import { SecretNetworkClient } from 'secretjs'; // used to connect to the secret network

// Define empty prompt function to call downstream.
const userPrompt = prompt(); 

// Create a secret.js client
const url = "https://1rpc.io/scrt-lcd"; // testing and local script url for secret network client
const secretjs = new SecretNetworkClient({
  url,
});

// Set up Axios with retry
axiosRetry(axios, {
  retries: 3, // Number of retries
  retryDelay: (retryCount) => retryCount * 1000, // Delay between retries in milliseconds
});

// collectionAddress to remain hardcoded as this script is for the Killroy collection.
const collectionAddress = "secret1d96jn9azwqw40paqyd5g02kz0ye0udhhqlue7j";
// made from the collectionAddress using the command `secretcli q compute contract-hash secret1d96jn9azwqw40paqyd5g02kz0ye0udhhqlue7j`
const sScrtCodeHash = "d36ac9c370eb86b82d14313ced45e84ccf2420ba0c38716ca6e9cf12a2cb5614"; 

var tokenId; // populated by user prompts
var walletAddress; // populated by user prompts
var viewingKey; // populated by user prompts

var full_movie; // object of full_movie private_metadata
var full_movie_key; // object of full_movie_key private_metadata
var lostChapterTeaser // second object of media private_metadata
let lastPartNumber; // used in teaser download

/**
 * The entry point of the script 
 */
async function start() {
  try {
    await enterUserTokenInfo();
    await getAllTokenInfo();
    await downloadMovie();
    await downloadTeaser();
  } catch (e) {
    throw e;
  }
}

async function enterUserTokenInfo() {
  // Step 1: Check if the user wants to download the movie
  const walletAddressEntry = userPrompt('Please enter your wallet address: ');
  walletAddress = walletAddressEntry;
  const tokenIdEntry = userPrompt('Please enter your Killroy token id: ');
  tokenId = tokenIdEntry;
  const viewingKeyEntry = userPrompt('Please enter your Killroy token viewing key: ');
  viewingKey = viewingKeyEntry;
}

/**
 * 
 */
async function getAllTokenInfo() {
  console.log("<getAllTokenInfo> START...");
  try {
    // Query the token ID for testing
    const token_info = await secretjs.query.compute.queryContract({
      contract_address: collectionAddress,
      code_hash: sScrtCodeHash,
      query: { nft_dossier: { token_id: tokenId, viewer: { address: walletAddress, viewing_key: viewingKey } } },
    });
    // console.log(`NFT_DOSSIER: ${JSON.stringify(token_info, null, 2)}`); // uncomment to view full dossier of Killroy NFT
    full_movie = token_info.nft_dossier.private_metadata.extension.attributes[1];
    full_movie_key = token_info.nft_dossier.private_metadata.extension.attributes[2];
    lostChapterTeaser = token_info.nft_dossier.private_metadata.extension.media[1];
    // console.log(`FULL MOVIE:\n`, full_movie, `\n\nFULL MOVIE KEY:\n`, full_movie_key, `\n\nLOST CHAPTER TEASER:\n`, lostChapterTeaser); // uncomment to view full parameter objects
    console.log("<getAllTokenInfo> DONE.");
  } catch (error) {
    console.error("<getAllTokenInfo> Error querying contract info:", error.message);
  }
}


async function downloadMovie() {
  console.log("<downloadMovie> START...");
  // Prompt the user if they want to download the movie
  console.log(`*************************************************************\n`);
  console.log("FULL MOVIE DOWNLOAD INSTRUCTIONS:");
  console.log("The full file is 7GB and is an archive file.");
  console.log("Downloading the full 'Killroy Was Here' movie will take a while.");
  console.log(`The file can be decompressed with your password: ${full_movie_key.value}`);
  console.log(`\n+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n`);
  console.log("TEASER DOWNLOAD INSTRUCTIONS:");
  console.log("NOTICE: You must have ffmpeg installed to download the teaser.");
  console.log("To download your 'Killroy Was Here' lost chapter teaser wait until the full movie finishes downloading.");
  console.log("If you only want to download the teaser enter 'n' on the prompt below.");
  console.log(`\n*************************************************************`);
  // Step 1: Check if the user wants to download the movie
  const shouldDownload = userPrompt('Do you want to download the full movie? (yes/no): ');
  // If neither 'y' nor 'yes' is entered return and close function
  if (shouldDownload.toLowerCase() !== 'yes' && shouldDownload.toLowerCase() !== 'y') {
    console.log('<downloadMovie> Movie download canceled.');
    return;
  }

  // Construct the download URL. initial full_movie.value is ipfs://<string>. .replace will remove ipfs://
  // gateway.pinata.cloud has the best results downloading this file with stablity and speed.
  const downloadUrl = `https://gateway.pinata.cloud/ipfs/${full_movie.value.replace('ipfs://', '')}`;

  // Set download file name to hide the original full_movie value. And for clarity.
  const localFilePath = 'killroy_was_here_full_movie.rar';

  // download the movie using the contructed download url and file name 'killroy_was_here_full_movie.rar'
  await fullMovieDownload(downloadUrl, localFilePath);

  // Since unzipping a file over 4gb can't be done easily in javascript write the password to password.txt
  // The file will contain your password for easy copy/paste when you extract the movie.
  await createPasswordFile();

  console.log("<downloadMovie> DONE.");
  return;
}

async function fullMovieDownload(url, localFilePath) {
  console.log(`\n<fullMovieDownload> START...\n`);
  const response = await axios({
    method: 'get',
    url: url,
    responseType: 'stream',
  });

  const totalSize = parseInt(response.headers['content-length'], 10);

  const progressBar = new cliProgress.SingleBar(
    {
      format: `Downloading... [{bar}] {percentage}% | {value}/{total}`,
    },
    cliProgress.Presets.shades_classic
  );
  progressBar.start(totalSize, 0);

  const writer = fs.createWriteStream(localFilePath);

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);

    response.data.on('data', (chunk) => {
      progressBar.increment(chunk.length);
    });

    writer.on('finish', () => {
      progressBar.stop();
      console.log('\n<fullMovieDownload> File download completed.');
      resolve();
    });

    writer.on('error', (err) => {
      progressBar.stop();
      console.error('<fullMovieDownload> Error writing to file:', err.message);
      reject(err);
    });
  });
  console.log("<fullMovieDownload> DONE.");
}

/**
 * When the movie download finishes create a password.txt document
 * in the current folder containing the unzip password
 * for killroy_was_here_full_movie.rar
 */
async function createPasswordFile() {
  console.log("<downloadMovie> Called");
  const fileName = 'password.txt';

  const content = `Your full_movie_key is:
  
${full_movie_key.value}
  
Use the full_movie_key to extract killroy_was_here_full_movie.rar with 7zip, winrar, or other decompression software.`;

  try {
    // Write content to the file
    fs.writeFileSync(fileName, content);

    console.log(`<downloadMovie> Password file '${fileName}' created successfully.`);
  } catch (error) {
    console.error('<downloadMovie> Error creating password file:', error.message);
  }
}

async function downloadTeaser() {
  console.log("<downloadTeaser> START...");
  // Define the pattern for extracting the variable name
  const pattern = /KWH_TheLostChapter_issue\d+[a-zA-Z]/;
  const match = lostChapterTeaser.url.match(pattern);
  const chapterName = match[0];
  // Step 1: Check if the user wants to download the teaser
  const shouldDownload = userPrompt('Do you want to download the lost chapter teaser? (yes/no): ');
  // If neither 'y' nor 'yes' is entered return and close function
  if (shouldDownload.toLowerCase() !== 'yes' && shouldDownload.toLowerCase() !== 'y') {
    console.log('<downloadTeaser> Teaser download canceled.');
    return;
  }

  const response = await axios({
    method: 'get',
    url: lostChapterTeaser.url,
    responseType: 'text',
  });

  // Use regular expression to find the match in the URL
  fs.writeFile(`./${chapterName}.m3u8`, response.data, function (err) {
    if (err) {
      return console.log(err);
    }
    console.log("<downloadTeaser> The teaser manifest file was saved!");
  });

  await setUrlsInFile(chapterName);

  const ffmpegCommand = `ffmpeg -y -protocol_whitelist file,http,https,tcp,tls,crypto -i ${chapterName}.m3u8 -c copy -bsf:a aac_adtstoasc ${chapterName}.mp4`;
  console.log("<downloadTeaser> Starting teaser download with ffmpeg. Please wait.");

  var counter = 0;
  // Use spawn instead of exec
  const ffmpegProcess = exec(ffmpegCommand);

  // Log progress and errors from ffmpeg
  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`ffmpeg progress: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    if (data.includes(`${chapterName}/part_`)) {
      counter++;
      console.log(`Downloading Part: ${counter}/${lastPartNumber}`);
    }
  });

  // Handle the close event
  ffmpegProcess.on('close', (code) => {
    if (code === 0) {
      console.log(`<downloadTeaser> ${chapterName}.mp4 has been saved successfully`);
    } else {
      console.error(`<downloadTeaser> ffmpeg process exited with code ${code}`);
    }
  });
}

async function setUrlsInFile(m3u8File) {
  console.log("<setUrlsInFile> Called");
  // Read the content of the m3u8 file
  let content = await fsPromise.readFile(`./${m3u8File}.m3u8`, 'utf-8', (err) => err && console.error(err));
  try {
    // Replace key://0.key with your personal teaser auth key.
    content = content.replace(/key:\/\/0\.key/g, `https://killroy-main-backend.azurewebsites.net/api/GetVideoKey/?key=${lostChapterTeaser.authentication.key}`);

    // Prepend lostChapterTeaser.url to all parts for download
    const teaserUrl = `https://killroy.azureedge.net/teasers/${m3u8File}/`;
    content = content.replace(/part_(\d+)\.ts/g, (match, partNumber) => teaserUrl + match);

    // Find and log the last /part_ number to track download
    const lastPartMatch = content.match(/part_(\d+)\.ts/g);
    lastPartNumber = lastPartMatch ? parseInt(lastPartMatch[lastPartMatch.length - 1].match(/\d+/)[0]) : null;

    // Write the modified content back to the file for download
    await fsPromise.writeFile(`${m3u8File}.m3u8`, content);

    console.log('<setUrlsInFile> URLs set in m3u8 file successfully.');
  } catch (error) {
    console.error('<setUrlsInFile> Error setting URLs in file:', error.message);
  }
}

start()