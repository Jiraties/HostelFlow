import ModalCloseButton from "../../components/ModalCloseButton";
import RecentActivities from "./RecentActivities";

const ViewActivities = ({
  userId,
  name,
  onClose,
}: {
  userId: string;
  name: string;
  onClose: () => void;
}) => {
  return (
    <div className="addBooking__wrapper">
      <ModalCloseButton onClick={onClose} />
      <h1 className="addBooking__title">ประวัติของ {name}</h1>
      <RecentActivities userId={userId} />
    </div>
  );
};

export default ViewActivities;
