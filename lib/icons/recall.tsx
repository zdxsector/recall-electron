import React from 'react';

export default function RecallLogo() {
  return (
    <svg className="logo" width="96" height="96" viewBox="0 0 176 176">
      <defs>
        <linearGradient
          id="recall-bg"
          x1="0"
          y1="0"
          x2="176"
          y2="176"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FBC541" />
          <stop offset="100%" stopColor="#F0992A" />
        </linearGradient>
      </defs>
      <rect width="176" height="176" rx="38" fill="url(#recall-bg)" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="#fff"
        d="M42 148V28h64q34 0 34 30t-34 30H82l48 44q10 14-8 18-22 4-36-18L64 98v50ZM64 46h36q18 0 18 14t-18 14H64Z"
      />
    </svg>
  );
}
