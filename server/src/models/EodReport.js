import mongoose from 'mongoose';

const { Schema } = mongoose;

export const EOD_STATUSES = ['submitted', 'verified', 'returned'];

const taskSnap = new Schema(
  {
    taskId: Schema.Types.ObjectId,
    title: String,
    category: String,
    startTime: String,
    endTime: String,
    minutes: Number,
    target: String,
    status: String,
    outputNotes: String,
  },
  { _id: false }
);

const historySchema = new Schema(
  { at: { type: Date, default: Date.now }, by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, action: String, note: { type: String, default: '' } },
  { _id: false }
);

// End-of-day report. `snapshot` freezes "planned vs actual" at submission time so later edits cannot change what was reviewed.
const eodSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    summary: { type: String, required: true, maxlength: 3000 },
    blockers: { type: String, default: '', maxlength: 1500 },
    status: { type: String, enum: EOD_STATUSES, default: 'submitted', index: true },
    snapshot: {
      tasks: [taskSnap],
      plannedCount: Number,
      completedCount: Number,
      inProgressCount: Number,
      pendingCount: Number,
      plannedMinutes: Number,
      completedMinutes: Number,
    },
    submittedAt: { type: Date, default: Date.now },
    resubmitCount: { type: Number, default: 0 },
    reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewerComment: { type: String, default: '' },
    rating: { type: Number, min: 1, max: 5 },
    history: [historySchema],
  },
  { timestamps: true }
);
eodSchema.index({ user: 1, date: 1 }, { unique: true });
eodSchema.index({ date: 1, status: 1 });

export const EodReport = mongoose.models.EodReport || mongoose.model('EodReport', eodSchema);
