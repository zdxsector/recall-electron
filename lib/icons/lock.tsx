import React from 'react';

type Props = {
  filled?: boolean;
};

export default function LockIcon({ filled = false }: Props) {
  if (filled) {
    return (
      <svg
        className="icon-lock icon-lock-filled"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 80"
      >
        <defs>
          <linearGradient
            id="icon-lock-filled-gradient"
            x1="14"
            x2="52"
            y1="16"
            y2="72"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#626262" offset="0" />
            <stop stopColor="#4a4a4a" offset="1" />
          </linearGradient>
        </defs>
        <path
          fill="url(#icon-lock-filled-gradient)"
          d="M15 33h34c6.1 0 10.7 4.9 10.7 11.2v18.7C59.7 69.2 55 74 49 74H15C8.9 74 4.3 69.2 4.3 62.9V44.2C4.3 37.9 8.9 33 15 33Z"
        />
        <path
          fill="url(#icon-lock-filled-gradient)"
          d="M32 4.5c13.2 0 23.5 10.6 23.5 24.4V37H44.7v-8.1c0-7.8-5.5-13.7-12.7-13.7s-12.7 5.9-12.7 13.7V37H8.5v-8.1C8.5 15.1 18.8 4.5 32 4.5Z"
        />
      </svg>
    );
  }

  return (
    <svg
      className="icon-lock"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      data-stroke-icon=""
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
