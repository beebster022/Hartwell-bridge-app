Lake Hartwell Bridge Clearance App v3.1

NETLIFY UPLOAD INSTRUCTIONS
1. Unzip the ZIP file.
2. Drag the unzipped folder named hartwell-bridge-clearance-v3.1-netlify into Netlify Drop.
3. Do not drag the outer ZIP file, and do not drag a parent folder that contains this project folder.
4. After it deploys, open the Netlify HTTPS link on your iPhone in Safari.
5. Allow Location permission when prompted.

IMPORTANT
- GPS needs HTTPS. It will not work reliably from a local iPhone file.
- Live lake level is requested through /.netlify/functions/lake-level first.
- If the Netlify function is unavailable, the app tries a direct USGS JSON fallback.
- Bridge coordinates are first-pass coordinates and should be verified before production use.

VERSION
v3.1: Cleaner Netlify root folder, improved lake-level fallback, clearer iPhone GPS warning, and safer upload instructions.
