import { Router } from 'express';
import { z } from 'zod';
import { createDepartment, createDesignation, createOffice, createShift, listDepartments, listDesignations, listOffices, listShifts, updateDepartment, updateDesignation, updateOffice, updateShift } from '../controllers/configuration-controller.js';
import { allowRoles, requireAuth } from '../middleware/auth.js';
import { ADMIN_ROLES, MANAGER_ROLES } from '../constants/roles.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { env } from '../config/env.js';

const officeSchema = z.object({ name: z.string().trim().min(2).max(100), address: z.string().trim().max(500).optional(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().int().positive().max(5000).default(env.DEFAULT_GEOFENCE_RADIUS_METERS), active: z.boolean().default(true) });
const officeUpdateSchema = officeSchema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
const shiftSchema = z.object({ name: z.string().trim().min(2).max(80), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), graceMinutes: z.number().int().min(0).max(240).default(15), breakMinutes: z.number().int().min(0).max(480).default(60), weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7).refine((days) => new Set(days).size === days.length, 'Weekly off days must be unique').default([0, 6]), active: z.boolean().default(true) });
const shiftUpdateSchema = shiftSchema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field');
const masterNameSchema = z.object({ name: z.string().trim().min(2).max(100) });
const masterUpdateSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, 'Provide at least one field');

const offices = Router();
offices.use(requireAuth);
offices.get('/', allowRoles(...MANAGER_ROLES), asyncHandler(listOffices));
offices.post('/', allowRoles(...ADMIN_ROLES), validate(officeSchema), asyncHandler(createOffice));
offices.patch('/:id', allowRoles(...ADMIN_ROLES), validate(officeUpdateSchema), asyncHandler(updateOffice));

const shifts = Router();
shifts.use(requireAuth);
shifts.get('/', allowRoles(...MANAGER_ROLES), asyncHandler(listShifts));
shifts.post('/', allowRoles(...ADMIN_ROLES), validate(shiftSchema), asyncHandler(createShift));
shifts.patch('/:id', allowRoles(...ADMIN_ROLES), validate(shiftUpdateSchema), asyncHandler(updateShift));

const departments = Router();
departments.use(requireAuth);
departments.get('/', allowRoles(...MANAGER_ROLES), asyncHandler(listDepartments));
departments.post('/', allowRoles(...ADMIN_ROLES), validate(masterNameSchema), asyncHandler(createDepartment));
departments.patch('/:id', allowRoles(...ADMIN_ROLES), validate(masterUpdateSchema), asyncHandler(updateDepartment));

const designations = Router();
designations.use(requireAuth);
designations.get('/', allowRoles(...MANAGER_ROLES), asyncHandler(listDesignations));
designations.post('/', allowRoles(...ADMIN_ROLES), validate(masterNameSchema), asyncHandler(createDesignation));
designations.patch('/:id', allowRoles(...ADMIN_ROLES), validate(masterUpdateSchema), asyncHandler(updateDesignation));

export { offices as officeRoutes, shifts as shiftRoutes, departments as departmentRoutes, designations as designationRoutes };
