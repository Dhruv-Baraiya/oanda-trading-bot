import mongoose from 'mongoose';

export async function connectDB(uri?: string): Promise<void> {
  const mongoUri = uri ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/trading';
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
