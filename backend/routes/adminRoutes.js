const express = require('express');
const {
  getReport,
  downloadReport,
  getPendingSalons,
  setSalonApproval,
  getCustomers,
  getCustomerOptions,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getManagedSalons,
  getSalonOptions,
  createManagedSalon,
  updateManagedSalon,
  deleteManagedSalon,
  getManagedBookings,
  updateManagedBookingStatus,
  confirmManagedBookingPayment,
  rejectManagedBookingPayment,
} = require('../controllers/adminController');
const { protect, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(protect, requireRole('admin'));
router.get('/dashboard', getReport);
router.get('/reports', getReport);
router.get('/reports.csv', downloadReport);
router.get('/salons/pending', getPendingSalons);
router.patch('/salons/:id/approval', setSalonApproval);
router.get('/management/customers', getCustomers);
router.get('/management/customer-options', getCustomerOptions);
router.post('/management/customers', createCustomer);
router.patch('/management/customers/:id', updateCustomer);
router.delete('/management/customers/:id', deleteCustomer);
router.get('/management/salons', getManagedSalons);
router.get('/management/salon-options', getSalonOptions);
router.post('/management/salons', createManagedSalon);
router.patch('/management/salons/:id', updateManagedSalon);
router.delete('/management/salons/:id', deleteManagedSalon);
router.get('/management/bookings', getManagedBookings);
router.patch('/management/bookings/:id/status', updateManagedBookingStatus);
router.patch('/management/bookings/:id/payment-confirmation', confirmManagedBookingPayment);
router.patch('/management/bookings/:id/payment-rejection', rejectManagedBookingPayment);

module.exports = router;
