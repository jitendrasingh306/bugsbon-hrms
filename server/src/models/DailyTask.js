import mongoose from 'mongoose';

const { Schema } = mongoose;

export const TASK_CATEGORIES = ['sales', 'development', 'testing', 'hr', 'design', 'other'];
export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    action: { type: String, required: true },
    fromStatus: String,
    toStatus: String,
    note: { type: String, default: '' },
  },
  { _id: false }
);

// One time-bound task of one person on one day, e.g. 11:00-14:00 "Cold calls".
const dailyTaskSchema = new Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // company-timezone calendar day
    assignee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    category: { type: String, enum: TASK_CATEGORIES, default: 'other' },
    target: { type: String, default: '', maxlength: 200 }, // planned output, e.g. "40 calls"
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    startMin: { type: Number, required: true },
    endMin: { type: Number, required: true },
    status: { type: String, enum: TASK_STATUSES, default: 'pending' },
    outputNotes: { type: String, default: '', maxlength: 2000 },
    startedAt: Date,
    completedAt: Date,
    cancelReason: { type: String, default: '' },
    history: [historySchema],
  },
  { timestamps: true }
);
dailyTaskSchema.index({ assignee: 1, date: 1, startMin: 1 });
dailyTaskSchema.index({ date: 1, status: 1 });

export const DailyTask = mongoose.models.DailyTask || mongoose.model('DailyTask', dailyTaskSchema);
