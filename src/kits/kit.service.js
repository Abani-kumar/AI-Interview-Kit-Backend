import { Kit } from '../models/Kit.js';
export const getKitForUser = (id, userId) => Kit.findOne({ _id: id, userId });
export const listKitsForUser = (userId) => Kit.find({ userId }).sort({ updatedAt: -1 });
