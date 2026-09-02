export function PersonalOsBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="personalOsBrand">
      <svg
        className="personalOsMark"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M12 2.8a7.6 7.6 0 0 0-7.6 7.6v4.1A4.7 4.7 0 0 0 9.1 19h5.8a4.7 4.7 0 0 0 4.7-4.5v-4.1A7.6 7.6 0 0 0 12 2.8Z" />
        <path d="M8.2 9.7c.7-1.3 2-2.1 3.8-2.1s3.1.8 3.8 2.1M9.2 13.1h.1m5.4 0h.1" />
      </svg>
      {!compact && <span className="personalOsBrandText">Personal OS</span>}
    </span>
  );
}
