export const REVIEW_QUEUE_UPDATED_EVENT =
  "hostelflow:review-queue-updated";

export const notifyReviewQueueUpdated = () => {
  window.dispatchEvent(new Event(REVIEW_QUEUE_UPDATED_EVENT));
};
