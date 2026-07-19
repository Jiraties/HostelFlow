export type LegacyDepositAudit = {
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  expectedCash?: number;
  actualCash?: number;
  variance?: number;
  preparation?: {
    targetBusinessDate: string;
    requiredAmount: number;
    preparedAmount: number;
    adjustment: number;
    refundBookingCount: number;
  };
};

export type DepositReturnReminderBooking = {
  bookingId: string;
  guestName: string;
  roomIds: string[];
  checkOut: string | Date;
  amount: number;
};

export type DepositReturnReminder = {
  businessDate: string;
  targetBusinessDate: string;
  requiredAmount: number;
  bookingCount: number;
  bookings: DepositReturnReminderBooking[];
  overdueAmount: number;
  overdueBookingCount: number;
  overdueBookings: DepositReturnReminderBooking[];
  calculationToken: string;
  calculatedAt: string | Date;
};

export type CashShift = {
  _id: string;
  businessDate: string;
  shiftNumber: number;
  staffUsername: string;
  status: "open" | "closed";
  openingMode: "counted" | "accepted_handoff";
  handoffFromShiftId?: string;
  operatingOpeningCash: number;
  operatingCashIn: number;
  operatingCashOut: number;
  operatingExpectedCash: number;
  operatingActualCash?: number;
  operatingVariance?: number;
  note?: string;
  startedAt: string | Date;
  endedAt?: string | Date;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  closedBy?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  isFinalDayClose?: boolean;
  depositReturnReminder?: {
    targetBusinessDate: string;
    requiredAmount: number;
    bookingCount: number;
    bookings: DepositReturnReminderBooking[];
    calculationToken: string;
    calculatedAt: string | Date;
    acknowledgedAt: string | Date;
    acknowledgedBy: string;
  };
  legacyDeposit?: LegacyDepositAudit;
};

export type CashPositionData = {
  businessDate: string;
  threshold: number;
  activeShift: CashShift | null;
  previousShift: CashShift | null;
  current: { operatingCash: number };
  handoff: {
    operatingCash: number;
    fromShiftId?: string;
    fromShiftNumber?: number;
  };
  shifts: CashShift[];
};
