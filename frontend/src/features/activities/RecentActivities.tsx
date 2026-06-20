import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { API_URL } from "../../config/api";
import type {
  activity,
  roomStay,
  transaction,
} from "../../types/activitiesTypes";

const ACTIVITY_PAGE_SIZE = 10;

const actionMap = {
  NEW_BOOKING: { icon: "bx-plus", text: "เพิ่ม Booking" },
  REMOVE_BOOKING: { icon: "bx-trash", text: "ลบ Booking" },
  EDIT_BOOKING: { icon: "bx-edit", text: "แก้ไข Booking" },
  CHECK_IN: { icon: "bx-check-circle", text: "Check-In" },
  CHECK_OUT: { icon: "bx-door-open", text: "Check-Out" },
  MANAGE_ROOM_STAYS: {
    icon: "bx-calendar-cog",
    text: "แก้ช่วงการเข้าพัก",
  },
  ADD_TRANSACTION: {
    icon: "bx-dollar",
    text: "เพิ่มรายการใช้จ่าย",
  },
  CREATE_USER: {
    icon: "bx-user-plus",
    text: "สร้างผู้ใช้",
  },
  RESET_USER_PASSWORD: {
    icon: "bx-key",
    text: "เปลี่ยนรหัสผ่าน",
  },
  UPDATE_USER: {
    icon: "bx-user-cog",
    text: "แก้ไขผู้ใช้",
  },
  DEACTIVATE_USER: {
    icon: "bx-user-x",
    text: "ปิดใช้งานผู้ใช้",
  },
  REACTIVATE_USER: {
    icon: "bx-user-check",
    text: "เปิดใช้งานผู้ใช้",
  },
  LOGOUT: {
    icon: "bx-arrow-out-right-square-half",
    text: "ออกจากระบบ",
  },
  LOGIN: {
    icon: "bx-arrow-in-right-square-half",
    text: "เข้าสู่ระบบ",
  },
} satisfies Record<activity["action"], { icon: string; text: string }>;

const transactionLabelMap = {
  roomCharge: "ค่าห้อง",
  deposit: "รับมัดจำ",
  adjustment: "ปรับราคา",
  depositRefund: "คืนมัดจำ",
  cancellationRefund: "คืนเงินยกเลิก",
  towel: "ผ้าเช็ดตัว",
  motorbike: "มอเตอร์ไซค์",
  slowBoat: "Slow Boat",
  joinTour: "Join Tour",
  extraBed: "เตียงเสริม",
  cardSurcharge: "ค่าธรรมเนียมบัตร",
} satisfies Record<transaction["type"], string>;

const formatCurrency = (amount: number) =>
  amount.toLocaleString("th-TH", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    calendar: "gregory",
  });

const formatActivityDate = (date: Date) =>
  `${date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${date.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  })}`;

const formatRoomStay = (stay: roomStay) =>
  `${stay.roomId}: ${formatDate(stay.from)} - ${formatDate(stay.to)}`;

const getAddedTransactions = (item: activity) => {
  if (item.action !== "ADD_TRANSACTION") return [];

  const summaryTransactions = item.details.summary?.addedTransactions;
  if (summaryTransactions?.length) return summaryTransactions;

  const transactions = item.details.changes?.transactions;
  if (!transactions) return [];

  return transactions.after.slice(transactions.before.length);
};

const getRoomStayChange = (item: activity) => {
  if (item.action !== "MANAGE_ROOM_STAYS") return null;

  const summary = item.details.summary;
  if (summary?.beforeRoomStays?.length || summary?.afterRoomStays?.length) {
    return {
      before: summary.beforeRoomStays || [],
      after: summary.afterRoomStays || [],
    };
  }

  const roomStays = item.details.changes?.roomStays;
  if (!roomStays) return null;

  return {
    before: roomStays.before,
    after: roomStays.after,
  };
};

const ActivityHeader = ({ item }: { item: activity }) => {
  const action = actionMap[item.action];
  const date = new Date(item.timestamp);

  return (
    <div className="settings__activityHeader">
      <i className={`bx settings__activityIcon ${action.icon}`} />
      <div>
        <h3>{action.text}</h3>
        <p>{formatActivityDate(date)}</p>
      </div>
    </div>
  );
};

const RecentActivities = ({ userId }: { userId?: string }) => {
  const [activities, setActivities] = useState<activity[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const activitiesRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const fetchActivities = useCallback(
    async (pageToFetch: number, replace = false) => {
      if (replace) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError("");

      //       activitiesRouter.get("/recentActivities", recentActivities);
      // activitiesRouter.get("/users/:userId/recentActivities", recentActivities);

      const fetchedActivities = await axios.get(
        userId
          ? `${API_URL}/activities/users/${userId}/recentActivities`
          : `${API_URL}/activities/recentActivities`,
        {
          params: {
            page: pageToFetch,
            limit: ACTIVITY_PAGE_SIZE,
          },
          withCredentials: true,
        },
      );

      const nextPageActivities = fetchedActivities.data
        .activities as activity[];
      const totalActivityCount = fetchedActivities.data
        .totalActivitycount as number;

      setActivities((prev) => {
        const nextActivities = replace
          ? nextPageActivities
          : [...prev, ...nextPageActivities];

        setHasMore(
          nextActivities.length < totalActivityCount &&
            nextPageActivities.length > 0,
        );

        return nextActivities;
      });

      setLoading(false);
      setLoadingMore(false);
    },
    [],
  );

  useEffect(() => {
    setPage(1);
    fetchActivities(1, true).catch(() => {
      setError("ไม่สามารถโหลดประวัติได้");
      setLoading(false);
      setLoadingMore(false);
    });
  }, [fetchActivities, location]);

  useEffect(() => {
    if (page === 1) return;

    fetchActivities(page).catch(() => {
      setError("ไม่สามารถโหลดประวัติเพิ่มได้");
      setLoadingMore(false);
    });
  }, [fetchActivities, page]);

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    const scrollRoot = activitiesRef.current;

    if (!loadMoreElement || !scrollRoot || loading || loadingMore || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPage((prev) => prev + 1);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "0px 0px 128px 0px",
      },
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadingMore]);

  return (
    <div className="settings__activities" ref={activitiesRef}>
      {loading && (
        <div className="settings__activityStatus">กำลังโหลดประวัติ...</div>
      )}

      {activities.map((item) => {
        if (item.action === "NEW_BOOKING" || item.action === "REMOVE_BOOKING") {
          return (
            <div className="settings__activity" key={item.timestamp.toString()}>
              <ActivityHeader item={item} />

              <div className="settings__activityDetails">
                <p>
                  <strong>ชื่อผู้เข้าพัก:</strong> {item.details.snapshot?.name}
                </p>
                <p>
                  <strong>Check In:</strong>{" "}
                  {new Date(
                    item.details.snapshot?.checkIn || "",
                  ).toLocaleDateString("th-TH", { calendar: "gregory" })}
                </p>
                <p>
                  <strong>Check Out:</strong>{" "}
                  {new Date(
                    item.details.snapshot?.checkOut || "",
                  ).toLocaleDateString("th-TH", { calendar: "gregory" })}
                </p>
                <p>
                  <strong>ห้อง:</strong> {item.details.snapshot?.roomId}
                </p>
                <p>
                  <strong>ช่องทางการจอง:</strong>{" "}
                  {item.details.snapshot?.platformId}
                </p>
                <p>
                  <strong>ราคา:</strong> {item.details.snapshot?.price}
                </p>
                <p>
                  <strong>ช่องทางการจ่าย:</strong>{" "}
                  {item.details.snapshot?.paymentMethod}
                </p>
                <p>
                  <strong>Booking ID:</strong>{" "}
                  {item.details.snapshot?.bookingId}
                </p>
              </div>
            </div>
          );
        }

        if (item.action === "ADD_TRANSACTION") {
          const addedTransactions = getAddedTransactions(item);

          return (
            <div className="settings__activity" key={item.timestamp.toString()}>
              <ActivityHeader item={item} />

              <div className="settings__activityDetails">
                <p>
                  <strong>Booking ID:</strong> {item.bookingId}
                </p>
                {addedTransactions.map((transaction, index) => (
                  <p key={`${transaction.type}-${transaction.amount}-${index}`}>
                    <strong>{transactionLabelMap[transaction.type]}:</strong>{" "}
                    {formatCurrency(transaction.amount)} บาท (
                    {transaction.paymentMethod})
                  </p>
                ))}
              </div>
            </div>
          );
        }

        if (item.action === "MANAGE_ROOM_STAYS") {
          const roomStayChange = getRoomStayChange(item);

          return (
            <div className="settings__activity" key={item.timestamp.toString()}>
              <ActivityHeader item={item} />

              <div className="settings__activityDetails">
                <p>
                  <strong>Booking ID:</strong> {item.bookingId}
                </p>
                <p>
                  <strong>ก่อนแก้:</strong>{" "}
                  {roomStayChange?.before.map(formatRoomStay).join(", ") || "-"}
                </p>
                <p>
                  <strong>หลังแก้:</strong>{" "}
                  {roomStayChange?.after.map(formatRoomStay).join(", ") || "-"}
                </p>
              </div>
            </div>
          );
        }

        return (
          <div className="settings__activity" key={item.timestamp.toString()}>
            <ActivityHeader item={item} />
          </div>
        );
      })}

      {error && <div className="settings__activityStatus">{error}</div>}
      {loadingMore && (
        <div className="settings__activityStatus">กำลังโหลดเพิ่มเติม...</div>
      )}
      {hasMore && !loading && (
        <div className="settings__activityLoadMore" ref={loadMoreRef} />
      )}
    </div>
  );
};

export default RecentActivities;
