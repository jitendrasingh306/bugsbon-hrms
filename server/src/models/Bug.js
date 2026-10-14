import mongoose from 'mongoose';

const { Schema } = mongoose;

export const BUG_STATUSES = ['open', 'in_progress', 'ready_for_retest', 'reopened', 'closed'];
export const BUG_SEVERITIES = ['low', 'medium', 'high', 'critical'];

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

const bugSchema = new Schema(
  {
    bugNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 5000 },
    stepsToReproduce: { type: String, default: '', maxlength: 5000 },
    expectedResult: { type: String, default: '', maxlength: 2000 },
    actualResult: { type: String, default: '', maxlength: 2000 },
    severity: { type: String, enum: BUG_SEVERITIES, default: 'medium', index: true },
    status: { type: String, enum: BUG_STATUSES, default: 'open', index: true },
    build: { type: Schema.Types.ObjectId, ref: 'Build', required: true, index: true }, // found in
    fixedInBuild: { type: Schema.Types.ObjectId, ref: 'Build', default: null }, // fixed in
    rootBuild: { type: Schema.Types.ObjectId, ref: 'Build', required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // developer
    currentTester: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    attachments: [
      { originalName: String, storedName: String, size: Number, mimeType: String },
    ],
    comments: [
      {
        author: { type: Schema.Types.ObjectId, ref: 'User' },
        authorName: String,
        body: { type: String, maxlength: 3000 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    history: [historySchema],
    closedAt: Date,
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
bugSchema.index({ createdAt: -1 });

export const Bug = mongoose.models.Bug || mongoose.model('Bug', bugSchema);
