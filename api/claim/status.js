// GET /api/claim/status -> { youtube: boolean }  (claim button shows "Coming" while false)
import { enabled } from './_claim.js';
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ youtube: enabled() });
}
