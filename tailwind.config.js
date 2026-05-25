/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cp: {
          bg:           '#0c0c0c',
          card:         '#151515',
          elevated:     '#1f1f1f',
          border:       '#252525',
          'border-soft':'#383838',
          text:         '#ede8e0',
          muted:        '#7a7570',
          accent:       '#c4845c',
          'accent-hover':'#d4956a',
        },
      },
      fontFamily: {
        sans:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
