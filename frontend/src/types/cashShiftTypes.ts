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
