
import React from 'react';
import Loader from './Loader';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ isLoading, children, icon, ...props }) => {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 focus:ring-offset-slate-900 disabled:bg-sky-800 disabled:cursor-not-allowed transition-colors duration-200 ${props.className}`}
      disabled={isLoading || props.disabled}
    >
      {isLoading ? (
        <Loader />
      ) : (
        <>
          {icon && <span className="mr-2 -ml-1 h-5 w-5">{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
};

export default Button;
