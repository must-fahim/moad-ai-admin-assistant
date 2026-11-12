export function Loader({ label, pulse = false }: { label: string; pulse?: boolean }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      {pulse ? (
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      ) : (
        <i className="spin" aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={`skeleton-line ${index % 3 === 0 ? "short" : index % 3 === 1 ? "" : "mid"}`} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-card">
          <span className="skeleton-line short" />
          <span className="skeleton-line" />
          <span className="skeleton-line mid" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-row" key={row}>
          <span /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}
