/**
 * PDF/Report Generation API Routes
 *
 * POST   /api/reports/generate      — Generate a branded report
 * GET    /api/reports               — List generated reports
 * GET    /api/reports/templates     — Available report templates
 * GET    /api/reports/brand         — Get brand config
 * PUT    /api/reports/brand         — Update brand config
 * GET    /api/reports/:id           — Get specific report
 * GET    /api/reports/:id/html      — Get report HTML content
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getPdfReportService } from '../services/pdf-report-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';
import * as fs from 'node:fs/promises';

const router: RouterType = Router();

/**
 * GET /api/reports/templates
 */
router.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    const service = getPdfReportService();
    res.json(service.getTemplates());
  })
);

/**
 * GET /api/reports/brand
 */
router.get(
  '/brand',
  asyncHandler(async (_req, res) => {
    const service = getPdfReportService();
    const brand = await service.getBrand();
    res.json(brand);
  })
);

/**
 * PUT /api/reports/brand
 */
router.put(
  '/brand',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      companyName: z.string().optional(),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      fontFamily: z.string().optional(),
      tagline: z.string().optional(),
    });
    const update = schema.parse(req.body);
    const service = getPdfReportService();
    const brand = await service.updateBrand(update);
    res.json(brand);
  })
);

/**
 * POST /api/reports/generate
 */
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      title: z.string().min(1),
      subtitle: z.string().optional(),
      template: z.enum(['audit', 'summary', 'analysis', 'standup', 'custom']),
      content: z.string().min(1),
      brand: z
        .object({
          companyName: z.string().optional(),
          logoUrl: z.string().optional(),
          primaryColor: z.string().optional(),
          secondaryColor: z.string().optional(),
          accentColor: z.string().optional(),
          fontFamily: z.string().optional(),
          tagline: z.string().optional(),
        })
        .optional(),
      includeToc: z.boolean().optional(),
      includeTimestamp: z.boolean().optional(),
      includePageNumbers: z.boolean().optional(),
      author: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    });
    const data = schema.parse(req.body);
    const service = getPdfReportService();
    const report = await service.generateReport(data);
    res.status(201).json(report);
  })
);

/**
 * GET /api/reports
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getPdfReportService();
    const reports = await service.listReports(
      req.query.limit ? Number(String(req.query.limit)) : undefined
    );
    res.json(reports);
  })
);

/**
 * GET /api/reports/:id
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getPdfReportService();
    const report = await service.getReport(String(req.params.id));
    if (!report) throw new NotFoundError('Report not found');
    res.json(report);
  })
);

/**
 * GET /api/reports/:id/html — Serve the HTML report
 */
router.get(
  '/:id/html',
  asyncHandler(async (req, res) => {
    const service = getPdfReportService();
    const report = await service.getReport(String(req.params.id));
    if (!report) throw new NotFoundError('Report not found');

    try {
      const html = await fs.readFile(report.htmlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch {
      throw new NotFoundError('Report HTML file not found');
    }
  })
);

export { router as reportRoutes };
