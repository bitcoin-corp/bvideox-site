// GET /api/claim/status -> { youtube, code, google }  (claim button shows "Coming" while youtube is false)
import { enabled, codeEnabled, googleEnabled } from './_claim.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ youtube: enabled(), code: codeEnabled(), google: googleEnabled() });
}
