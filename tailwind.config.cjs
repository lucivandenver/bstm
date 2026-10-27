module.exports = { content: ['./views/**/*.xian', './public/js/**/*.js'], ...({
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
          },
          colors: {
            brand: {
              green: '#007042',
              darkGreen: '#005230',
              emerald: '#16a34a',
              pink: '#F43F5E',
              coral: '#FB7185',
              navy: '#0F172A',
              slate: '#1E293B',
              bgLight: '#F8FAFC'
            }
          }
        }
      }
    }) };
