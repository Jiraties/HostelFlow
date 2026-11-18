import "./PaymentMethodChip.css";

const PaymentMethodChip = ({
  method,
  label,
}: {
  method?: string | null;
  label?: string;
}) => {
  if (!method) return null;

  return (
    <span className="paymentMethodChip" data-method={method.toLowerCase()}>
      {label || method}
    </span>
  );
};

export default PaymentMethodChip;
