import { forwardRef, type HTMLAttributes, type ReactElement } from "react";

export { PreferenceCodeScroller };

type PreferenceCodeScrollerProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "aria-label" | "aria-labelledby" | "className"
> & {
  value: string;
};

const PreferenceCodeScroller = forwardRef<
  HTMLDivElement,
  PreferenceCodeScrollerProps
>(function PreferenceCodeScroller(
  { className, value, ...props },
  ref,
): ReactElement {
  return (
    <div
      {...props}
      className={["zp-pref-code-scroller", className].filter(Boolean).join(" ")}
      ref={ref}
      tabIndex={0}
    >
      <span className="zp-pref-code-scroller-value">{value}</span>
    </div>
  );
});
