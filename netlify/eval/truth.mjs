// Hand-labeled answers for the 7 test receipts (step 3), read off the photos.
// Amounts in dollars. qty null = not readable on the photo (any answer accepted).
// fees: in_subtotal = the line is printed among the items / counted in the subtotal.
// card_charge null = the photo doesn't show what the card was finally charged.

export const TRUTH = {
  toast1017: {
    label: 'Oct 17 tab, Toast screenshot',
    items: [
      ['Bloody Mary', 1, 10.00], ['Door County Cherry Mojito', 3, 30.00], ['Vacationland - Door County Brewing', 1, 6.00],
      ['Cherry Lemonade', 2, 18.00], ['Carbliss', 7, 42.00], ['Linneys summer shandy', 1, 6.00], ['Cheese Curds', 3, 26.85],
      ['Doco Cherry Salad', 1, 19.95], ['Fire Chicken Wrap', 1, 14.95], ['Chicken Wings (12)', 1, 14.95], ['House Salad', 1, 12.95],
      ['DoCo Pulled Pork', 1, 12.95], ['Fish and Chips', 2, 33.90], ['Philly Cheese Steak', 1, 16.95], ['Cherry Mule', 2, 20.00],
      ['Spotted Cow', 9, 45.00], ['Miller Light DFT', 1, 3.00], ['Rumpleminz', 4, 12.00], ['Fireball', 3, 9.00],
    ],
    subtotal: 354.45, fees: [{ label: 'Credit Card Surcharge (3.00%)', amount: 10.63, in_subtotal: false }],
    gratuity: null, tax: 9.01, total: 444.98, tip: 70.89, tip_in_total: true, card_charge: 444.98,
  },
  wildtomato: {
    label: 'Wild Tomato, Oct 18, 2026',
    items: [
      ['Fried Cheese Curds', 2, 24.00], ['Large Margherita', 1, 25.00], ['Large Sausage & Pesto', 1, 27.00], ['Large Hot Honey', 1, 27.00],
      ['Von Stiehl Cherry Cider DRFT', 2, 16.00], ['New Glarus Tailwagger DRFT', 1, 7.00], ['Bloody Mary', 1, 10.00], ['Diet Coke', 1, 4.00],
    ],
    subtotal: 140.00, fees: [{ label: 'Credit Card Surcharge (2.95%)', amount: 4.13, in_subtotal: false }],
    gratuity: null, tax: 7.96, total: 152.09, tip: 28.00, tip_in_total: false, card_charge: 180.09,
  },
  ranch616: {
    label: 'Ranch 616, Jul 2025',
    items: [
      ['Cactus Rita', 1, 14.00], ['Ranch Water', 7, 119.00], ['House Rita', 1, 13.00], ['Mexpresso', 1, 15.00], ['Ranch Queso', 2, 28.00],
      ['Jalapeño Maize Trout', 1, 27.00], ['Ceviche', 1, 21.00], ['Roasted Herb Chicken', 1, 29.00], ['Tortilla Soup', 1, 14.00],
      ["Ed's El Camino Shrimp Tacos", 2, 50.00], ['Tortilla Chips - Queso Half & Half', 2, 5.00], ['Fire in the Hole', 1, 11.00],
      ["Ed's El Camino Fish Tacos", 2, 44.00], ['Quesadilla', null, 36.00],
    ],
    subtotal: 426.00, fees: [], gratuity: 85.20, tax: 35.16, total: 546.36, tip: null, tip_in_total: null, card_charge: null,
  },
  olio: {
    label: 'Olio, Jul 2024',
    items: [
      ['44 Schiava, Alois Lageder', 2, 108.00], ['Fritto Primavera', 1, 23.00], ['Milanese Di Pollo', 1, 30.00], ['Special Lasagna', 1, 32.00],
      ['Fusilli Cinghiale E Funghi', 1, 25.00], ['Carbonara', 1, 24.00], ['Tagliatelle Cacio e Pepe', 1, 24.00],
    ],
    subtotal: 273.98, fees: [{ label: 'Restaurant Surcharge (3.00%)', amount: 7.98, in_subtotal: true }],
    gratuity: 53.20, tax: 31.30, total: 358.48, tip: null, tip_in_total: null, card_charge: 358.48,
  },
  barslip: {
    label: 'Bar slip, Sep 2025',
    items: [
      ["Tito's", 3, 36.00], ['Miller Lite', 1, 7.00], ['Revolution Oktoberfest', 1, 6.00], ['Sun Cruiser', 1, 8.00],
      ['Maplewood Son Of Juice', 1, 8.00], ['Stoli Blueberr', 1, 10.00],
    ],
    subtotal: 75.00, fees: [{ label: 'CC Fee', amount: 3.32, in_subtotal: false }],
    gratuity: null, tax: 8.07, total: 86.39, tip: 15.00, tip_in_total: false, card_charge: 101.39,
  },
  disco: {
    label: 'Disco Pancakes, Jan 2025',
    items: [
      ['House Coffee', 3, 9.00], ['Disco Skillet', 1, 15.00], ['Belgian Waffle', 1, 7.00], ['Biscuits & Gravy', 1, 18.00],
      ['Bacon', 1, 6.00], ['Build Your Own Omelet', 1, 14.00],
    ],
    subtotal: 69.00, fees: [], gratuity: null, tax: 8.14, total: 77.14, tip: null, tip_in_total: null, card_charge: null,
  },
  cvs: {
    label: 'CVS, Jun 2026',
    items: [['CORE PWR STRW BAN 14Z', 1, 4.99], ['CORE PWR VAN 14Z', 1, 4.99], ['KIND PROMX PB 4CT 2.2Z', 1, 12.49]],
    subtotal: null, fees: [], gratuity: null, tax: null, total: 22.47, tip: null, tip_in_total: null, card_charge: 22.47,
  },
};
