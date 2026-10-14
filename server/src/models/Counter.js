import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

/** Atomically increments and returns the next number of a named sequence. */
export async function nextSeq(name, session) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );
  return doc.seq;
}

export const formatNumber = (prefix, seq) => `${prefix}-${String(seq).padStart(4, '0')}`;
