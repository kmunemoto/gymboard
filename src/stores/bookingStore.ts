import { myBookings } from '@/lib/dummyData';

export interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  clientName: string;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function blocksOverlap(startA: string, startB: string): boolean {
  const a = timeToMin(startA);
  const b = timeToMin(startB);
  return a < b + 75 && b < a + 75;
}

// Simple global mutable store with listeners (no extra deps)
let bookings: Booking[] = myBookings.map((b) => ({
  ...b,
  clientName: '田中 太郎',
}));

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const bookingStore = {
  getBookings: () => bookings,

  addBooking: (booking: Booking) => {
    bookings = [...bookings, booking];
    notify();
  },

  removeBooking: (id: string) => {
    bookings = bookings.filter((b) => b.id !== id);
    notify();
  },

  isSlotBlocked: (date: string, startTime: string) => {
    return bookings.some(
      (b) => b.date === date && blocksOverlap(b.startTime, startTime)
    );
  },

  getBookingsForDate: (date: string) => {
    return bookings.filter((b) => b.date === date);
  },

  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
