import mongoose from 'mongoose';

const { Schema } = mongoose;

export const BUILD_STATUSES = ['pending_test', 'in_testing', 'failed', 'approved', 'superseded', 'withdrawn'];

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

// One document = one uploaded APK. The file fields are never modified after creation:
// a fixed APK is always a NEW build (iteration + 1) linked through previousBuild/rootBuild.
const buildSchema = new Schema(
  {
    buildNumber: { type: String, required: true, unique: true },
    projectName: { type: String, required: true, trim: true, maxlength: 120 },
    appName: { type: String, required: true, trim: true, maxlength: 120 },
    versionName: { type: String, required: true, trim: true, maxlength: 40 },
    versionCode: { type: String, trim: true, maxlength: 20 },
    releaseNotes: { type: String, default: '', maxlength: 5000 },
    iteration: { type: Number, default: 1 },
    previousBuild: { type: Schema.Types.ObjectId, ref: 'Build', default: null },
    rootBuild: { type: Schema.Types.ObjectId, ref: 'Build', index: true },
    developer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tester: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: BUILD_STATUSES, default: 'pending_test', index: true },
    file: {
      originalName: String,
      storedName: String,
      size: Number,
      sha256: { type: String, index: true },
      mimeType: String,
    },
    downloadCount: { type: Number, default: 0 },
    testerDownloadedAt: Date,
    testResult: {
      result: { type: String, enum: ['pass', 'fail'] },
      notes: String,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    history: [historySchema],
  },
  { timestamps: true }
);
buildSchema.index({ createdAt: -1 });

export const Build = mongoose.models.Build || mongoose.model('Build', buildSchema);
