type LiveRegionProps = {
  message: string;
  tone?: "polite" | "assertive";
};

/** Screen-reader announcement that is not shown in the layout. */
export function LiveRegion({ message, tone = "polite" }: LiveRegionProps) {
  return (
    <div
      className="visually-hidden"
      role={tone === "assertive" ? "alert" : "status"}
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
