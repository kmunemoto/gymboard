export interface Session {
  id: string;
  clientName: string;
  clientAvatar: string;
  date: string;
  time: string;
  duration: number;
  type: string;
  status: 'upcoming' | 'completed' | 'cancelled';
}

export interface Client {
  id: string;
  name: string;
  avatar: string;
  goal: string;
  nextSession: string;
  totalSessions: number;
  memberSince: string;
  progress: number;
  plan: PlanType;
  /** true = has completed at least one session; false = trial candidate */
  isExistingCustomer: boolean;
}

export interface BodyMetric {
  date: string;
  weight: number;
  bodyFat: number;
}

export interface ChatMessage {
  id: string;
  sender: 'trainer' | 'customer';
  text: string;
  time: string;
  date: string;
}

export interface TimeSlot {
  id: string;
  time: string;
  available: boolean;
}

export type PlanType = '初回無料体験' | '月4回' | '月6回' | '月8回' | '通い放題';

export const planOptions: PlanType[] = [
  '初回無料体験',
  '月4回',
  '月6回',
  '月8回',
  '通い放題',
];

export const planPrices: Record<PlanType, number> = {
  '初回無料体験': 0,
  '月4回': 20000,
  '月6回': 28500,
  '月8回': 36000,
  '通い放題': 60000,
};

// Trial session
export const trialPrice = 0;
export const trialLabel = '初回無料体験（60分）';

// Payment status for current month (dummy data)
export const clientPaymentStatus: Record<string, boolean> = {
  '1': true,
  '2': true,
  '3': false,
  '4': false,
  '5': true,
  '6': false,
};

// Current logged-in customer state (toggle to test trial vs existing)
// Set to true to simulate a first-time trial user
export const isTrialUser = false;

export interface CustomerBookingEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
}

export const currentPlan: PlanType = '月4回';

export const myBookings: CustomerBookingEntry[] = [
  { id: 'b1', date: '2026-04-09', startTime: '10:00', endTime: '11:00' },
  { id: 'b2', date: '2026-04-14', startTime: '14:00', endTime: '15:00' },
  { id: 'b3', date: '2026-04-18', startTime: '11:00', endTime: '12:00' },
];

export interface Photo {
  id: string;
  url: string;
  date: string;
  note: string;
}

// Trainer sessions
export const sessions: Session[] = [
  { id: '1', clientName: '田中 太郎', clientAvatar: 'T', date: '2026-04-09', time: '10:00', duration: 60, type: '上半身トレーニング', status: 'upcoming' },
  { id: '2', clientName: '鈴木 花子', clientAvatar: 'S', date: '2026-04-09', time: '11:30', duration: 60, type: '下半身トレーニング', status: 'upcoming' },
  { id: '3', clientName: '佐藤 健太', clientAvatar: 'K', date: '2026-04-09', time: '14:00', duration: 60, type: 'HIIT', status: 'upcoming' },
  { id: '4', clientName: '高橋 美咲', clientAvatar: 'M', date: '2026-04-09', time: '16:00', duration: 60, type: '全身トレーニング', status: 'upcoming' },
  { id: '5', clientName: '田中 太郎', clientAvatar: 'T', date: '2026-04-07', time: '10:00', duration: 60, type: '下半身トレーニング', status: 'completed' },
  { id: '6', clientName: '鈴木 花子', clientAvatar: 'S', date: '2026-04-05', time: '11:00', duration: 60, type: '上半身トレーニング', status: 'completed' },
];

export const clients: Client[] = [
  { id: '1', name: '田中 太郎', avatar: 'T', goal: '筋力アップ', nextSession: '4/9 10:00', totalSessions: 24, memberSince: '2025-10', progress: 72, plan: '月4回', isExistingCustomer: true },
  { id: '2', name: '鈴木 花子', avatar: 'S', goal: 'ダイエット', nextSession: '4/9 11:30', totalSessions: 18, memberSince: '2025-12', progress: 58, plan: '月6回', isExistingCustomer: true },
  { id: '3', name: '佐藤 健太', avatar: 'K', goal: '体力向上', nextSession: '4/9 14:00', totalSessions: 32, memberSince: '2025-08', progress: 85, plan: '月8回', isExistingCustomer: true },
  { id: '4', name: '高橋 美咲', avatar: 'M', goal: 'ボディメイク', nextSession: '4/9 16:00', totalSessions: 12, memberSince: '2026-01', progress: 40, plan: '通い放題', isExistingCustomer: true },
  { id: '5', name: '山田 翔太', avatar: 'Y', goal: '減量', nextSession: '4/10 10:00', totalSessions: 45, memberSince: '2025-04', progress: 92, plan: '月4回', isExistingCustomer: true },
  { id: '6', name: '中村 あおい', avatar: 'A', goal: '健康維持', nextSession: '未定', totalSessions: 0, memberSince: '2026-04', progress: 0, plan: '初回無料体験', isExistingCustomer: false },
];

// Per-client body metrics
export const clientBodyMetrics: Record<string, BodyMetric[]> = {
  '1': [
    { date: '11月', weight: 80.2, bodyFat: 24.5 },
    { date: '12月', weight: 78.8, bodyFat: 23.0 },
    { date: '1月', weight: 78.0, bodyFat: 22.0 },
    { date: '2月', weight: 76.5, bodyFat: 21.0 },
    { date: '3月', weight: 75.0, bodyFat: 19.5 },
    { date: '4月', weight: 73.8, bodyFat: 18.0 },
  ],
  '2': [
    { date: '12月', weight: 62.0, bodyFat: 30.0 },
    { date: '1月', weight: 60.5, bodyFat: 28.5 },
    { date: '2月', weight: 59.0, bodyFat: 27.0 },
    { date: '3月', weight: 58.0, bodyFat: 25.5 },
    { date: '4月', weight: 57.2, bodyFat: 24.0 },
  ],
  '3': [
    { date: '8月', weight: 70.0, bodyFat: 18.0 },
    { date: '9月', weight: 71.0, bodyFat: 17.5 },
    { date: '10月', weight: 71.5, bodyFat: 17.0 },
    { date: '11月', weight: 72.0, bodyFat: 16.5 },
    { date: '12月', weight: 72.5, bodyFat: 16.0 },
    { date: '1月', weight: 73.0, bodyFat: 15.5 },
    { date: '2月', weight: 73.5, bodyFat: 15.0 },
    { date: '3月', weight: 74.0, bodyFat: 14.5 },
    { date: '4月', weight: 74.2, bodyFat: 14.0 },
  ],
  '4': [
    { date: '1月', weight: 55.0, bodyFat: 28.0 },
    { date: '2月', weight: 54.5, bodyFat: 27.0 },
    { date: '3月', weight: 54.0, bodyFat: 26.0 },
    { date: '4月', weight: 53.5, bodyFat: 25.0 },
  ],
  '5': [
    { date: '4月', weight: 95.0, bodyFat: 30.0 },
    { date: '6月', weight: 92.0, bodyFat: 28.0 },
    { date: '8月', weight: 88.5, bodyFat: 25.5 },
    { date: '10月', weight: 85.0, bodyFat: 23.0 },
    { date: '12月', weight: 82.0, bodyFat: 21.0 },
    { date: '2月', weight: 79.5, bodyFat: 19.0 },
    { date: '4月', weight: 77.0, bodyFat: 17.5 },
  ],
  '6': [
    { date: '4月', weight: 58.0, bodyFat: 26.0 },
  ],
};

// Customer-facing data (default = client 1)
export const bodyMetrics: BodyMetric[] = clientBodyMetrics['1'];

// Generate slots: 60-min session + 15-min break = 75-min blocks
function generateTimeSlots(dateKey: string, bookedStarts: string[]): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const bookedMinutes = bookedStarts.map((t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  });

  for (let totalMin = 600; totalMin <= 1260; totalMin += 15) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    const isBlocked = bookedMinutes.some((bm) => {
      return totalMin < bm + 75 && totalMin + 75 > bm;
    });

    slots.push({
      id: `${dateKey}-${time}`,
      time,
      available: !isBlocked,
    });
  }
  return slots;
}

export const availableSlots: Record<string, TimeSlot[]> = {
  '2026-04-10': generateTimeSlots('2026-04-10', ['10:00', '16:00']),
  '2026-04-11': generateTimeSlots('2026-04-11', ['14:00']),
  '2026-04-12': generateTimeSlots('2026-04-12', ['15:00']),
  '2026-04-14': generateTimeSlots('2026-04-14', ['10:00']),
  '2026-04-15': generateTimeSlots('2026-04-15', []),
  '2026-04-16': generateTimeSlots('2026-04-16', ['13:00']),
  '2026-04-17': generateTimeSlots('2026-04-17', []),
  '2026-04-18': generateTimeSlots('2026-04-18', ['11:00']),
};

export const chatMessages: ChatMessage[] = [
  { id: '1', sender: 'trainer', text: 'お疲れ様でした！今日のトレーニングは素晴らしかったです💪', time: '18:30', date: '4/7' },
  { id: '2', sender: 'customer', text: 'ありがとうございます！次回も頑張ります！', time: '18:45', date: '4/7' },
  { id: '3', sender: 'trainer', text: '次回は下半身メインでいきましょう。スクワットのフォームも確認しますね。', time: '18:50', date: '4/7' },
  { id: '4', sender: 'trainer', text: '食事記録を見ました。タンパク質の摂取量が良い感じです👍 この調子で続けていきましょう！', time: '10:00', date: '4/8' },
  { id: '5', sender: 'customer', text: 'プロテインを朝と夜に飲むようにしています！', time: '12:15', date: '4/8' },
  { id: '6', sender: 'trainer', text: '明日のセッション楽しみにしています。体調はいかがですか？', time: '20:00', date: '4/8' },
  { id: '7', sender: 'customer', text: '体調バッチリです！よろしくお願いします🔥', time: '20:30', date: '4/8' },
];

export const photos: Photo[] = [
  { id: '1', url: '', date: '2026-01-15', note: '開始時' },
  { id: '2', url: '', date: '2026-02-15', note: '1ヶ月目' },
  { id: '3', url: '', date: '2026-03-15', note: '2ヶ月目' },
  { id: '4', url: '', date: '2026-04-07', note: '3ヶ月目' },
];

// Exercise master data with categories
export interface ExerciseMaster {
  id: string;
  name: string;
  category: string;
}

export const exerciseCategories = ['胸', '背中', '肩', '上腕二頭筋', '上腕三頭筋', '脚・臀部', '体幹・腹筋', 'その他'] as const;

export const defaultExerciseMasters: ExerciseMaster[] = [
  // 胸
  { id: 'ex-1', name: 'ベンチプレス', category: '胸' },
  { id: 'ex-2', name: 'インクラインダンベルプレス', category: '胸' },
  { id: 'ex-3', name: 'ケーブルフライ', category: '胸' },
  { id: 'ex-4', name: 'ダンベルフライ', category: '胸' },
  { id: 'ex-5', name: 'ケーブルプレス', category: '胸' },
  { id: 'ex-6', name: 'インクラインベンチ', category: '胸' },
  { id: 'ex-7', name: 'ディップス', category: '胸' },
  // 背中
  { id: 'ex-10', name: 'デッドリフト', category: '背中' },
  { id: 'ex-11', name: 'ベントオーバーロウ', category: '背中' },
  { id: 'ex-12', name: 'ラットプルダウン', category: '背中' },
  { id: 'ex-13', name: 'シーテッドロウ', category: '背中' },
  { id: 'ex-14', name: 'ダンベルロウ', category: '背中' },
  // 肩
  { id: 'ex-20', name: 'ショルダープレス', category: '肩' },
  { id: 'ex-21', name: 'ダンベルショルダープレス', category: '肩' },
  // 上腕三頭筋
  { id: 'ex-30', name: 'トライセプスプッシュダウン', category: '上腕三頭筋' },
  // 脚・臀部
  { id: 'ex-40', name: 'スクワット', category: '脚・臀部' },
  { id: 'ex-41', name: 'レッグプレス', category: '脚・臀部' },
  { id: 'ex-42', name: 'ヒップスラスト', category: '脚・臀部' },
  { id: 'ex-43', name: 'ブルガリアンスクワット', category: '脚・臀部' },
  { id: 'ex-44', name: 'レッグカール', category: '脚・臀部' },
  { id: 'ex-45', name: 'レッグエクステンション', category: '脚・臀部' },
  { id: 'ex-46', name: 'スミスマシンスクワット', category: '脚・臀部' },
  // その他
  { id: 'ex-90', name: 'HIIT', category: 'その他' },
];

export interface TrainingExercise {
  name: string;
  weight: number;
  reps: number;
}

export interface TrainingRecord {
  id: string;
  date: string;
  exercises: TrainingExercise[];
}

// Per-client training records
export const clientTrainingRecords: Record<string, TrainingRecord[]> = {
  '1': [
    { id: 'tr1-1', date: '2026-04-07', exercises: [
      { name: 'ベンチプレス', weight: 60, reps: 10 },
      { name: 'インクラインダンベルプレス', weight: 22, reps: 12 },
      { name: 'ケーブルフライ', weight: 15, reps: 15 },
    ]},
    { id: 'tr1-2', date: '2026-04-02', exercises: [
      { name: 'スクワット', weight: 80, reps: 8 },
      { name: 'レッグプレス', weight: 120, reps: 10 },
    ]},
    { id: 'tr1-3', date: '2026-03-28', exercises: [
      { name: 'ベンチプレス', weight: 57.5, reps: 10 },
      { name: 'ダンベルフライ', weight: 14, reps: 12 },
    ]},
    { id: 'tr1-4', date: '2026-03-24', exercises: [
      { name: 'デッドリフト', weight: 100, reps: 5 },
      { name: 'ベントオーバーロウ', weight: 50, reps: 10 },
    ]},
    { id: 'tr1-5', date: '2026-03-19', exercises: [
      { name: 'ベンチプレス', weight: 55, reps: 10 },
      { name: 'ショルダープレス', weight: 30, reps: 10 },
    ]},
    { id: 'tr1-6', date: '2026-03-14', exercises: [
      { name: 'スクワット', weight: 75, reps: 8 },
      { name: 'ベンチプレス', weight: 52.5, reps: 10 },
    ]},
    { id: 'tr1-7', date: '2026-03-07', exercises: [
      { name: 'ベンチプレス', weight: 50, reps: 10 },
      { name: 'スクワット', weight: 70, reps: 8 },
    ]},
    { id: 'tr1-8', date: '2026-02-28', exercises: [
      { name: 'ベンチプレス', weight: 47.5, reps: 10 },
      { name: 'デッドリフト', weight: 90, reps: 5 },
    ]},
  ],
  '2': [
    { id: 'tr2-1', date: '2026-04-05', exercises: [
      { name: 'ヒップスラスト', weight: 60, reps: 12 },
      { name: 'ブルガリアンスクワット', weight: 20, reps: 10 },
    ]},
    { id: 'tr2-2', date: '2026-04-01', exercises: [
      { name: 'ラットプルダウン', weight: 30, reps: 12 },
      { name: 'シーテッドロウ', weight: 25, reps: 12 },
    ]},
    { id: 'tr2-3', date: '2026-03-28', exercises: [
      { name: 'ヒップスラスト', weight: 55, reps: 12 },
      { name: 'レッグカール', weight: 20, reps: 15 },
    ]},
  ],
  '3': [
    { id: 'tr3-1', date: '2026-04-07', exercises: [
      { name: 'デッドリフト', weight: 130, reps: 5 },
      { name: 'ベンチプレス', weight: 80, reps: 8 },
      { name: 'スクワット', weight: 110, reps: 6 },
    ]},
    { id: 'tr3-2', date: '2026-04-03', exercises: [
      { name: 'ベンチプレス', weight: 77.5, reps: 8 },
      { name: 'ダンベルショルダープレス', weight: 28, reps: 10 },
    ]},
    { id: 'tr3-3', date: '2026-03-31', exercises: [
      { name: 'スクワット', weight: 105, reps: 6 },
      { name: 'レッグプレス', weight: 180, reps: 8 },
    ]},
  ],
  '4': [
    { id: 'tr4-1', date: '2026-04-08', exercises: [
      { name: 'スミスマシンスクワット', weight: 30, reps: 12 },
      { name: 'レッグエクステンション', weight: 25, reps: 15 },
    ]},
    { id: 'tr4-2', date: '2026-04-04', exercises: [
      { name: 'ケーブルプレス', weight: 10, reps: 15 },
      { name: 'トライセプスプッシュダウン', weight: 12, reps: 15 },
    ]},
  ],
  '5': [
    { id: 'tr5-1', date: '2026-04-06', exercises: [
      { name: 'ベンチプレス', weight: 90, reps: 6 },
      { name: 'インクラインベンチ', weight: 70, reps: 8 },
      { name: 'ディップス', weight: 20, reps: 10 },
    ]},
    { id: 'tr5-2', date: '2026-04-02', exercises: [
      { name: 'スクワット', weight: 120, reps: 5 },
      { name: 'デッドリフト', weight: 140, reps: 3 },
    ]},
    { id: 'tr5-3', date: '2026-03-30', exercises: [
      { name: 'ベンチプレス', weight: 87.5, reps: 6 },
      { name: 'ダンベルロウ', weight: 35, reps: 10 },
    ]},
  ],
  '6': [],
};

// Default training records (customer view = client 1)
export const trainingRecords: TrainingRecord[] = clientTrainingRecords['1'];

// Per-client bookings
export const clientBookings: Record<string, CustomerBookingEntry[]> = {
  '1': [
    { id: 'b1-1', date: '2026-04-09', startTime: '10:00', endTime: '11:00' },
    { id: 'b1-2', date: '2026-04-14', startTime: '14:00', endTime: '15:00' },
  ],
  '2': [
    { id: 'b2-1', date: '2026-04-09', startTime: '11:30', endTime: '12:30' },
    { id: 'b2-2', date: '2026-04-15', startTime: '10:00', endTime: '11:00' },
  ],
  '3': [
    { id: 'b3-1', date: '2026-04-09', startTime: '14:00', endTime: '15:00' },
  ],
  '4': [
    { id: 'b4-1', date: '2026-04-09', startTime: '16:00', endTime: '17:00' },
  ],
  '5': [
    { id: 'b5-1', date: '2026-04-10', startTime: '10:00', endTime: '11:00' },
  ],
  '6': [],
};
export const clientChatMessages: Record<string, ChatMessage[]> = {
  '1': chatMessages,
  '2': [
    { id: 'c2-1', sender: 'trainer', text: '今日のトレーニングお疲れ様でした！下半身の調子が良くなってきましたね😊', time: '17:00', date: '4/5' },
    { id: 'c2-2', sender: 'customer', text: 'ありがとうございます！ヒップスラストが楽しくなってきました！', time: '17:30', date: '4/5' },
  ],
  '3': [
    { id: 'c3-1', sender: 'trainer', text: 'デッドリフト130kg、素晴らしい記録です！🎉', time: '15:00', date: '4/7' },
    { id: 'c3-2', sender: 'customer', text: '次は135kgを目指します！', time: '15:30', date: '4/7' },
  ],
  '4': [
    { id: 'c4-1', sender: 'trainer', text: 'フォームがとても綺麗になりましたね！', time: '17:30', date: '4/8' },
    { id: 'c4-2', sender: 'customer', text: '嬉しいです！もっと頑張ります💪', time: '18:00', date: '4/8' },
  ],
  '5': [
    { id: 'c5-1', sender: 'trainer', text: '減量ペースが理想的です。このまま維持していきましょう。', time: '12:00', date: '4/6' },
    { id: 'c5-2', sender: 'customer', text: '食事管理も頑張っています！', time: '12:30', date: '4/6' },
  ],
  '6': [
    { id: 'c6-1', sender: 'trainer', text: '初回体験のご予約ありがとうございます！当日お待ちしております😊', time: '10:00', date: '4/9' },
    { id: 'c6-2', sender: 'customer', text: 'よろしくお願いします！楽しみです！', time: '10:30', date: '4/9' },
  ],
};
