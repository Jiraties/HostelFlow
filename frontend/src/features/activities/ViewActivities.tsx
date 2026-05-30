import RecentActivities from "./RecentActivities";

const ViewActivities = ({ userId, name }: { userId: string; name: string }) => {
  return (
    <div className="addBooking__wrapper">
      <h1 className="addBooking__title">ประวัติของ {name}</h1>
      <RecentActivities userId={userId} />
    </div>
  );
};

export default ViewActivities;
