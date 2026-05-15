import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { createApp } from './createApp.js';

const app = createApp();
const port = process.env.PROD_PORT || process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(
    `S3 config: bucket=${process.env.PROD_S3_BUCKET || process.env.S3_BUCKET || '(unset)'} endpoint=${process.env.PROD_S3_ENDPOINT || process.env.S3_ENDPOINT || `https://s3.${process.env.PROD_S3_REGION || process.env.S3_REGION || 'fr-par'}.scw.cloud`}`
  );
  console.log(`Share viewer (static): http://localhost:${port}/viewer/`);
});
