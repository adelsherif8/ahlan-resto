import { log } from "../config.js";

// Upload any public asset with the bucket-bootstrap dance in ONE place: try, create
// the bucket if missing, retry, return the public URL. Null on failure — a missing
// asset must never block a reply.
export async function uploadPublic(db, bucket, path, buffer, contentType, opts = {}) {
  return uploadPublicPdf(db, bucket, path, buffer, { contentType, ...opts });
}

export async function uploadPublicPdf(db, bucket, path, buffer, opts = {}) {
  try {
    const options = { contentType: "application/pdf", upsert: true, ...opts };
    let { error } = await db.storage.from(bucket).upload(path, buffer, options);
    if (error) {
      await db.storage.createBucket(bucket, { public: true }).catch(() => {});
      ({ error } = await db.storage.from(bucket).upload(path, buffer, options));
      if (error) throw new Error(error.message);
    }
    const { data } = db.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    log(`upload ${bucket}/${path} failed:`, e.message);
    return null;
  }
}
