import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({ userId: mongoose.Schema.Types.ObjectId, expiresAt: Date });
export const Session = mongoose.model('Session', sessionSchema);
