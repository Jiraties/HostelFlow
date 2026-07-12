export type CashShift = {
  _id: string;
  businessDate: string;
  shiftNumber: number;
  staffUsername: string;
  status: "open" | "closed";
  openingMode: "counted" | "accepted_handoff";
  handoffFromShiftId?: string;
  depositOpeningCash: number;
  operatingOpeningCash: number;
  depositCashIn: number;
  depositCashOut: number;
  operatingCashIn: number;
  operatingCashOut: number;
  depositExpectedCash: number;
  operatingExpectedCash: number;
  depositActualCash?: number;
  operatingActualCash?: number;
  depositVariance?: number;
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
};

export type CashPositionData = {
  businessDate: string;
  threshold: number;
  activeShift: CashShift | null;
  previousShift: CashShift | null;
  current: { depositCash: number; operatingCash: number };
  handoff: {
    depositCash: number;
    operatingCash: number;
    fromShiftId?: string;
    fromShiftNumber?: number;
  };
  shifts: CashShift[];
};
