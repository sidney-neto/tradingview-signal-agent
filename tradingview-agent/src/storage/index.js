'use strict';

const { createAnalysisRepository } = require('./analysisRepository');
const {
  isPersistenceEnabled,
  shouldPersistAnalyzeRoute,
  persistAnalysisSnapshot,
  persistMtfAnalysisResults,
} = require('./persistence');

module.exports = {
  createAnalysisRepository,
  isPersistenceEnabled,
  shouldPersistAnalyzeRoute,
  persistAnalysisSnapshot,
  persistMtfAnalysisResults,
};
