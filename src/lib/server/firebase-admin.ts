import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// Read env from Astro private server env first, then process.env (dev/process)
const FIREBASE_PROJECT_ID =
    (import.meta as any).env?.FIREBASE_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL =
    (import.meta as any).env?.FIREBASE_CLIENT_EMAIL ??
    process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY_RAW =
    (import.meta as any).env?.FIREBASE_PRIVATE_KEY ??
    process.env.FIREBASE_PRIVATE_KEY;

if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID environment variable is required");
}
if (!FIREBASE_CLIENT_EMAIL) {
    throw new Error("FIREBASE_CLIENT_EMAIL environment variable is required");
}
if (!FIREBASE_PRIVATE_KEY_RAW) {
    throw new Error("FIREBASE_PRIVATE_KEY environment variable is required");
}

// Remove surrounding quotes and restore newlines
const FIREBASE_PRIVATE_KEY = FIREBASE_PRIVATE_KEY_RAW.replace(
    /^"|"$/g,
    ""
).replace(/\\n/g, "\n");

const app = getApps().length
    ? getApps()[0]
    : initializeApp({
          credential: cert({
              projectId: FIREBASE_PROJECT_ID,
              clientEmail: FIREBASE_CLIENT_EMAIL,
              privateKey: FIREBASE_PRIVATE_KEY,
          }),
      });

export const db = getFirestore(app);
export { FieldValue, Timestamp };
