import React from 'react';

export default function EllipsisOutlineIcon() {
  return (
    <svg
      className="icon-ellipsis-outline"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      data-stroke-icon=""
    >
      <circle cx="12" cy="12" r="10" />
      <circle className="icon-dot" cx="12" cy="12" r="1.2" />
      <circle className="icon-dot" cx="8" cy="12" r="1.2" />
      <circle className="icon-dot" cx="16" cy="12" r="1.2" />
    </svg>
  );
}
