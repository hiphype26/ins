// Dashboard Application

// Check authentication on load
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    
    // Load user info
    try {
        const user = await api('/auth/me');
        document.getElementById('user-email').textContent = user.email;
    } catch (error) {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
        return;
    }
    
    // Initialize navigation
    initNavigation();
    
    // Load initial data
    await loadDashboard();
    await loadSettings();
    
    // Check hash for direct page access
    const hash = window.location.hash.slice(1) || 'dashboard';
    showPage(hash);
});

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            showPage(page);
            window.location.hash = page;
        });
    });
    
    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.slice(1) || 'dashboard';
        showPage(hash);
    });
}

function showPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
    
    // Show selected page
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) {
            item.classList.add('active');
        }
    });
    
    // Only stop the countdown display when leaving Volna Test (keep auto-refresh running)
    if (pageName !== 'volna-test') {
        if (volnaCountdownInterval) {
            clearInterval(volnaCountdownInterval);
            volnaCountdownInterval = null;
        }
    }
    
    // Load page-specific data
    if (pageName === 'dashboard') {
        loadDashboard();
    } else if (pageName === 'job-data') {
        loadJobData();
    } else if (pageName === 'volna-test') {
        // Auto-fetch on page load
        fetchVolnaJobs();
        
        // Restore auto-refresh UI state if it's still running
        const checkbox = document.getElementById('volna-auto-refresh');
        const nextRefreshContainer = document.getElementById('volna-next-refresh-container');
        if (volnaAutoRefreshInterval) {
            checkbox.checked = true;
            nextRefreshContainer.style.display = 'inline';
            // Restart countdown display
            updateNextRefreshCountdown();
            volnaCountdownInterval = setInterval(updateNextRefreshCountdown, 1000);
        } else {
            checkbox.checked = false;
            nextRefreshContainer.style.display = 'none';
        }
    } else if (pageName === 'settings') {
        checkUpworkStatus();
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
}

// Dashboard
async function loadDashboard() {
    try {
        // Load stats
        const stats = await api('/jobs/stats/queue');
        document.getElementById('stat-queued').textContent = stats.queued || 0;
        document.getElementById('stat-processing').textContent = stats.processing || 0;
        document.getElementById('stat-completed').textContent = stats.completed || 0;
        document.getElementById('stat-failed').textContent = stats.failed || 0;
        document.getElementById('stat-rate-limit').textContent = 
            `${stats.rateLimitUsed || 0}/${stats.rateLimitMax || 50}`;
        
        // Load Upwork status
        const upwork = await api('/upwork/status');
        const statusEl = document.getElementById('stat-upwork-status');
        if (upwork.connected) {
            statusEl.textContent = 'Connected';
            statusEl.style.color = 'var(--success)';
        } else {
            statusEl.textContent = 'Not Connected';
            statusEl.style.color = 'var(--danger)';
        }
        
        // Check maintenance mode
        const settings = await api('/settings');
        const maintenanceMode = settings.find(s => s.key === 'maintenance_mode');
        const banner = document.getElementById('maintenance-banner');
        if (maintenanceMode && maintenanceMode.value === 'true') {
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
        
        // Load Volna filter stats
        await loadVolnaFilterStats();
        
        // Load API stats
        await loadApiStats('today');
    } catch (error) {
        console.error('Failed to load dashboard:', error);
    }
}

// Load Job Stats from Database
async function loadVolnaFilterStats() {
    const container = document.getElementById('volna-filter-stats');
    
    try {
        const response = await api('/volna/stats');
        
        // Use database stats (jobs saved in system)
        const db = response.database || {};
        const timeRanges = response.timeRanges || {};
        
        // Format time ranges for display
        const formatTimeRange = (start, end) => {
            const startTime = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${startTime} - ${endTime}`;
        };
        const formatDateRange = (start, end) => {
            const startDate = new Date(start);
            const endDate = new Date(end);
            const startStr = startDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${startStr} - ${endStr}`;
        };
        
        const oneHourRange = timeRanges.oneHourAgo && timeRanges.now 
            ? formatTimeRange(timeRanges.oneHourAgo, timeRanges.now) 
            : '';
        const twentyFourHourRange = timeRanges.twentyFourHoursAgo && timeRanges.now 
            ? formatDateRange(timeRanges.twentyFourHoursAgo, timeRanges.now) 
            : '';
        
        const byStatus = db.byStatus || {};
        const processed = response.processed || {};
        const byHourUTCYesterday = processed.byHourUTCYesterday || {};
        const byHourUTCToday = processed.byHourUTCToday || {};
        const filterIds = response.filterIds || [];
        const apiCalls = response.apiCalls || {};
        
        // Format current time for display
        const nowFormatted = timeRanges.nowFormatted || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        const yesterdayDate = timeRanges.yesterdayDate || '';
        const todayDate = timeRanges.todayDate || '';
        
        // Build hourly rows for yesterday
        const hourlyRowsYesterday = [];
        for (let h = 0; h < 24; h += 1) {
            const count = byHourUTCYesterday[h] || 0;
            if (count > 0) {
                const startHour = h.toString().padStart(2, '0');
                const endHour = ((h + 1) % 24).toString().padStart(2, '0');
                hourlyRowsYesterday.push(`
                    <div class="filter-stat-row">
                        <span class="filter-stat-label">${startHour}:00 - ${endHour}:00 UTC</span>
                        <span class="filter-stat-value highlight">${count}</span>
                    </div>
                `);
            }
        }
        
        // Build hourly rows for today
        const hourlyRowsToday = [];
        for (let h = 0; h < 24; h += 1) {
            const count = byHourUTCToday[h] || 0;
            if (count > 0) {
                const startHour = h.toString().padStart(2, '0');
                const endHour = ((h + 1) % 24).toString().padStart(2, '0');
                hourlyRowsToday.push(`
                    <div class="filter-stat-row">
                        <span class="filter-stat-label">${startHour}:00 - ${endHour}:00 UTC</span>
                        <span class="filter-stat-value highlight">${count}</span>
                    </div>
                `);
            }
        }
        
        // Build filter IDs display
        const filterIdsDisplay = filterIds.length > 0 
            ? filterIds.map(id => `<span class="filter-id-tag">#${id}</span>`).join(' ')
            : '<span style="color: var(--gray-500);">None configured</span>';
        
        container.innerHTML = `
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Volna Filter IDs</span>
                    <span class="filter-stat-badge">Config</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Active Filters</span>
                    <span class="filter-stat-value">${filterIdsDisplay}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Current Time (UTC)</span>
                    <span class="filter-stat-value time-display">${nowFormatted}</span>
                </div>
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Jobs Saved in System</span>
                    <span class="filter-stat-badge">Database</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Jobs added in last 1 hour <span class="time-range">(${oneHourRange})</span></span>
                    <span class="filter-stat-value highlight">${db.lastHour || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Jobs added yesterday <span class="time-range">(${yesterdayDate})</span></span>
                    <span class="filter-stat-value highlight">${db.yesterday || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Jobs added today <span class="time-range">(${todayDate})</span></span>
                    <span class="filter-stat-value highlight">${db.today || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Total jobs in database</span>
                    <span class="filter-stat-value">${db.total || 0}</span>
                </div>
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Jobs by Status</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Queued</span>
                    <span class="filter-stat-value">${byStatus.queued || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Processing</span>
                    <span class="filter-stat-value">${byStatus.processing || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Completed</span>
                    <span class="filter-stat-value highlight">${byStatus.completed || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Failed</span>
                    <span class="filter-stat-value" style="color: var(--danger);">${byStatus.failed || 0}</span>
                </div>
                <div class="filter-stat-divider">Performance</div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Success Rate</span>
                    <span class="filter-stat-value ${db.successRate >= 90 ? 'highlight' : ''}" style="${db.successRate < 90 ? 'color: var(--warning);' : ''}">${db.successRate || 0}%</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Avg Processing Time</span>
                    <span class="filter-stat-value">${db.avgProcessingTimeMinutes || 0} min</span>
                </div>
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Top Countries</span>
                    <span class="filter-stat-badge">Clients</span>
                </div>
                ${(db.topCountries && db.topCountries.length > 0) ? db.topCountries.map((c, i) => `
                <div class="filter-stat-row">
                    <span class="filter-stat-label">${i + 1}. ${c.country}</span>
                    <span class="filter-stat-value">${c.count}</span>
                </div>
                `).join('') : '<div class="filter-stat-row"><span class="filter-stat-label" style="color: var(--gray-500);">No country data yet</span></div>'}
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">LeadHack Status</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Pending</span>
                    <span class="filter-stat-value">${response.leadhack?.pending || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Sent</span>
                    <span class="filter-stat-value highlight">${response.leadhack?.sent || 0}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Failed</span>
                    <span class="filter-stat-value" style="color: var(--danger);">${response.leadhack?.failed || 0}</span>
                </div>
                ${response.leadhack?.nextSendAt ? `
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Next Send</span>
                    <span class="filter-stat-value time-display">${new Date(response.leadhack.nextSendAt).toISOString().replace('T', ' ').substring(0, 19)} UTC</span>
                </div>
                ` : ''}
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">API Calls Yesterday</span>
                    <span class="filter-stat-badge">${yesterdayDate}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Upwork</span>
                    <span class="filter-stat-value">${apiCalls.yesterday?.upwork?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.yesterday?.upwork?.failed || 0} failed)</span></span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Volna</span>
                    <span class="filter-stat-value">${apiCalls.yesterday?.volna?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.yesterday?.volna?.failed || 0} failed)</span></span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">LeadHack</span>
                    <span class="filter-stat-value">${apiCalls.yesterday?.leadhack?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.yesterday?.leadhack?.failed || 0} failed)</span></span>
                </div>
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">API Calls Today</span>
                    <span class="filter-stat-badge">${todayDate}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Upwork</span>
                    <span class="filter-stat-value">${apiCalls.today?.upwork?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.today?.upwork?.failed || 0} failed)</span></span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Volna</span>
                    <span class="filter-stat-value">${apiCalls.today?.volna?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.today?.volna?.failed || 0} failed)</span></span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">LeadHack</span>
                    <span class="filter-stat-value">${apiCalls.today?.leadhack?.total || 0} <span style="color: var(--danger); font-size: 11px;">(${apiCalls.today?.leadhack?.failed || 0} failed)</span></span>
                </div>
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Processed Yesterday</span>
                    <span class="filter-stat-badge">${yesterdayDate}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Total processed</span>
                    <span class="filter-stat-value highlight">${processed.yesterday || 0}</span>
                </div>
                <div class="filter-stat-divider">By Hour (UTC)</div>
                ${hourlyRowsYesterday.length > 0 ? hourlyRowsYesterday.join('') : '<div class="filter-stat-row"><span class="filter-stat-label" style="color: var(--gray-500);">No jobs processed</span></div>'}
            </div>
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Processed Today</span>
                    <span class="filter-stat-badge">${todayDate}</span>
                </div>
                <div class="filter-stat-row">
                    <span class="filter-stat-label">Total processed</span>
                    <span class="filter-stat-value highlight">${processed.today || 0}</span>
                </div>
                <div class="filter-stat-divider">By Hour (UTC)</div>
                ${hourlyRowsToday.length > 0 ? hourlyRowsToday.join('') : '<div class="filter-stat-row"><span class="filter-stat-label" style="color: var(--gray-500);">No jobs processed yet</span></div>'}
            </div>
        `;
    } catch (error) {
        container.innerHTML = `
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Error loading stats</span>
                </div>
                <p style="color: var(--danger); font-size: 13px;">${error.message}</p>
            </div>
        `;
    }
}

// API Stats
let currentStatsRange = 'today';

async function loadApiStats(range = 'today') {
    currentStatsRange = range;
    
    // Update button states
    document.querySelectorAll('.stats-range-selector .btn-sm').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`stats-btn-${range}`);
    if (activeBtn) activeBtn.classList.add('active');
    
    try {
        // Load summary stats
        const summary = await api(`/stats/summary?range=${range}`);
        
        document.getElementById('api-total-calls').textContent = summary.total || 0;
        document.getElementById('api-upwork-calls').textContent = summary.byType?.upwork?.total || 0;
        document.getElementById('api-volna-calls').textContent = summary.byType?.volna?.total || 0;
        document.getElementById('api-leadhack-calls').textContent = summary.byType?.leadhack?.total || 0;
        
        // Calculate total failures
        let totalFailed = 0;
        if (summary.byType) {
            Object.values(summary.byType).forEach(type => {
                totalFailed += type.failed || 0;
            });
        }
        document.getElementById('api-failed-calls').textContent = totalFailed;
        
        // Load hourly stats for peak hours by API
        const hourly = await api(`/stats/hourly?range=${range}`);
        const peaks = hourly.peaks || {};
        
        // Get date label based on range
        const now = new Date();
        let dateLabel = now.toISOString().split('T')[0]; // Today
        if (range === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            dateLabel = `${weekAgo.toISOString().split('T')[0]} - ${dateLabel}`;
        } else if (range === 'month') {
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            dateLabel = `${monthAgo.toISOString().split('T')[0]} - ${dateLabel}`;
        }
        
        // Update Upwork peak
        if (peaks.upwork && peaks.upwork.peakCount > 0) {
            const hour = peaks.upwork.peakHour;
            document.getElementById('peak-upwork').textContent = 
                `${hour.toString().padStart(2, '0')}:00 (${peaks.upwork.peakCount} calls)`;
            document.getElementById('peak-upwork-date').textContent = dateLabel;
        } else {
            document.getElementById('peak-upwork').textContent = '-';
            document.getElementById('peak-upwork-date').textContent = '';
        }
        
        // Update Volna peak
        if (peaks.volna && peaks.volna.peakCount > 0) {
            const hour = peaks.volna.peakHour;
            document.getElementById('peak-volna').textContent = 
                `${hour.toString().padStart(2, '0')}:00 (${peaks.volna.peakCount} calls)`;
            document.getElementById('peak-volna-date').textContent = dateLabel;
        } else {
            document.getElementById('peak-volna').textContent = '-';
            document.getElementById('peak-volna-date').textContent = '';
        }
        
        // Update LeadHack peak
        if (peaks.leadhack && peaks.leadhack.peakCount > 0) {
            const hour = peaks.leadhack.peakHour;
            document.getElementById('peak-leadhack').textContent = 
                `${hour.toString().padStart(2, '0')}:00 (${peaks.leadhack.peakCount} calls)`;
            document.getElementById('peak-leadhack-date').textContent = dateLabel;
        } else {
            document.getElementById('peak-leadhack').textContent = '-';
            document.getElementById('peak-leadhack-date').textContent = '';
        }
        
        // Load daily chart
        await loadDailyChart();
        
    } catch (error) {
        console.error('Failed to load API stats:', error);
    }
}

async function loadDailyChart() {
    const chartContainer = document.getElementById('daily-chart');
    
    try {
        const daily = await api('/stats/daily?days=7');
        const days = daily.daily || {};
        
        // Get dates for last 7 days
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }
        
        // Find max value for scaling
        let maxValue = 1;
        dates.forEach(date => {
            const dayData = days[date];
            if (dayData && dayData.total > maxValue) {
                maxValue = dayData.total;
            }
        });
        
        // Generate chart bars
        chartContainer.innerHTML = dates.map(date => {
            const dayData = days[date] || { total: 0, upwork: 0, volna: 0, leadhack: 0 };
            const height = maxValue > 0 ? (dayData.total / maxValue) * 120 : 4;
            const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
            const dateNum = new Date(date + 'T00:00:00').getDate();
            
            return `
                <div class="chart-bar-container">
                    <div class="chart-value">${dayData.total}</div>
                    <div class="chart-bar" style="height: ${Math.max(height, 4)}px;">
                        <div class="bar-tooltip">
                            Upwork: ${dayData.upwork || 0}<br>
                            Volna: ${dayData.volna || 0}<br>
                            LeadHack: ${dayData.leadhack || 0}
                        </div>
                    </div>
                    <div class="chart-label">${dayName}<br>${dateNum}</div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Failed to load daily chart:', error);
        chartContainer.innerHTML = '<p style="color: var(--gray-500);">Failed to load chart</p>';
    }
}

// Job Data
let allJobsData = []; // Store jobs for modal access

// Helper to get value from result with volnaData fallback
function getJobValue(job, field) {
    const result = job.result || {};
    const volna = job.volnaData || {};
    return result[field] || volna[field] || null;
}

// Helper to format LeadHack status badge
function getLeadhackStatusBadge(job) {
    const status = job.leadhackStatus;
    
    if (!status) {
        // Job completed before LeadHack tracking was added, or still processing
        if (job.status === 'completed') {
            return '<span class="leadhack-badge lh-none">-</span>';
        }
        return '-';
    }
    
    if (status === 'pending') {
        // Show countdown to send time
        if (job.leadhackSendAt) {
            const sendAt = new Date(job.leadhackSendAt);
            const now = new Date();
            const diffMs = sendAt - now;
            
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                return `<span class="leadhack-badge lh-pending" title="Sends at ${sendAt.toLocaleString()}">⏳ ${hours}h ${mins}m</span>`;
            } else {
                return '<span class="leadhack-badge lh-pending">⏳ Soon</span>';
            }
        }
        return '<span class="leadhack-badge lh-pending">⏳ Pending</span>';
    }
    
    if (status === 'sent') {
        return '<span class="leadhack-badge lh-sent">✓ Sent</span>';
    }
    
    if (status === 'failed') {
        return `<span class="leadhack-badge lh-failed" title="${job.leadhackError || 'Unknown error'}">✗ Failed</span>`;
    }
    
    return '-';
}

async function loadJobData() {
    try {
        const jobs = await api('/jobs');
        allJobsData = jobs || []; // Store for later access
        
        const tbody = document.getElementById('job-data-body');
        const emptyState = document.getElementById('job-data-empty');
        const tableContainer = document.querySelector('#page-job-data .table-container');
        
        if (!jobs || jobs.length === 0) {
            tableContainer.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        
        tableContainer.style.display = 'block';
        emptyState.style.display = 'none';
        
        tbody.innerHTML = jobs.map((job, index) => {
            // Use Upwork result with Volna fallback for country
            const title = getJobValue(job, 'title');
            const city = getJobValue(job, 'client_city'); // Only from Upwork
            const country = getJobValue(job, 'client_country'); // Upwork or Volna fallback
            const rating = getJobValue(job, 'client_rating');
            
            return `
                <tr>
                    <td><a href="${job.jobUrl}" target="_blank" class="job-url">${job.jobUrl}</a></td>
                    <td>${escapeHtml(title) || '-'}</td>
                    <td>${escapeHtml(city) || '-'}</td>
                    <td>${escapeHtml(country) || '-'}</td>
                    <td>${rating || '-'}</td>
                    <td><span class="status-badge status-${job.status}">${job.status}</span></td>
                    <td>${getLeadhackStatusBadge(job)}</td>
                    <td>
                        <button class="btn btn-secondary btn-small" onclick="showJobModalByIndex(${index})">
                            View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load job data:', error);
        showToast('Failed to load job data', 'error');
    }
}

// Helper to escape HTML to prevent XSS and broken rendering
function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#039;');
}

// Show modal by job index
function showJobModalByIndex(index) {
    const job = allJobsData[index];
    if (job) {
        showJobModal(job);
    }
}

function refreshJobData() {
    loadJobData();
    showToast('Job data refreshed');
}

// Job Modal
function showJobModal(job) {
    const modal = document.getElementById('job-modal');
    const modalBody = document.getElementById('modal-body');
    const result = job.result || {};
    
    // Use Upwork result with Volna fallback
    const title = getJobValue(job, 'title');
    const country = getJobValue(job, 'client_country');
    const rating = getJobValue(job, 'client_rating');
    const reviews = getJobValue(job, 'client_reviews');
    const totalSpent = getJobValue(job, 'client_spend') || getJobValue(job, 'client_total_spent');
    const totalHires = getJobValue(job, 'client_hires') || getJobValue(job, 'client_total_hires');
    const verified = getJobValue(job, 'client_verified');
    
    modalBody.innerHTML = `
        <div class="modal-detail-grid">
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Job URL</div>
                <div class="modal-detail-value">
                    <a href="${job.jobUrl}" target="_blank">${job.jobUrl}</a>
                </div>
            </div>
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Title</div>
                <div class="modal-detail-value">${title || '-'}</div>
            </div>
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Description</div>
                <div class="modal-detail-value description">${result.description || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Skills</div>
                <div class="modal-detail-value">${result.skills || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Posted Date</div>
                <div class="modal-detail-value">${result.posted_date || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Budget</div>
                <div class="modal-detail-value">${result.budget || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Proposals Count</div>
                <div class="modal-detail-value">${result.proposals_count || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Name</div>
                <div class="modal-detail-value">${result.client_name || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client City</div>
                <div class="modal-detail-value">${result.client_city || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Country</div>
                <div class="modal-detail-value">${country || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Total Spent</div>
                <div class="modal-detail-value">${totalSpent || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Hires</div>
                <div class="modal-detail-value">${totalHires || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Reviews</div>
                <div class="modal-detail-value">${reviews || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Rating</div>
                <div class="modal-detail-value">${rating || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Payment Verified</div>
                <div class="modal-detail-value">${verified ? 'Yes' : 'No'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Status</div>
                <div class="modal-detail-value">
                    <span class="status-badge status-${job.status}">${job.status}</span>
                </div>
            </div>
            ${job.error ? `
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Error</div>
                <div class="modal-detail-value" style="color: var(--danger);">${job.error}</div>
            </div>
            ` : ''}
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('job-modal').classList.add('hidden');
}

// Test Page
async function submitTestJob() {
    const urlInput = document.getElementById('job-url-input');
    const submitText = document.getElementById('test-submit-text');
    const submitLoading = document.getElementById('test-submit-loading');
    const resultContainer = document.getElementById('test-result-container');
    
    const jobUrl = urlInput.value.trim();
    
    if (!jobUrl) {
        showToast('Please enter a job URL', 'error');
        return;
    }
    
    // Show loading state
    submitText.classList.add('hidden');
    submitLoading.classList.remove('hidden');
    
    try {
        // Submit job for processing
        const response = await api('/jobs/test', {
            method: 'POST',
            body: JSON.stringify({ jobUrl })
        });
        
        // Display results
        displayTestResults(response);
        resultContainer.classList.remove('hidden');
        showToast('Job details fetched successfully', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to fetch job details', 'error');
    } finally {
        submitText.classList.remove('hidden');
        submitLoading.classList.add('hidden');
    }
}

function displayTestResults(data) {
    const grid = document.getElementById('test-result-grid');
    
    const fields = [
        { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description', class: 'description' },
        { key: 'skills', label: 'Skills' },
        { key: 'posted_date', label: 'Posted Date' },
        { key: 'budget', label: 'Budget' },
        { key: 'proposals_count', label: 'Proposals Count' },
        { key: 'client_name', label: 'Client Name' },
        { key: 'client_city', label: 'Client City' },
        { key: 'client_country', label: 'Client Country' },
        { key: 'client_spend', label: 'Client Total Spent' },
        { key: 'client_hires', label: 'Client Hires' },
        { key: 'client_reviews', label: 'Client Reviews' },
        { key: 'client_rating', label: 'Client Rating' },
        { key: 'client_verified', label: 'Payment Verified' }
    ];
    
    grid.innerHTML = fields.map(field => `
        <div class="result-item">
            <div class="result-label">${field.label}</div>
            <div class="result-value ${field.class || ''}">${
                field.key === 'client_verified' 
                    ? (data[field.key] ? 'Yes' : 'No')
                    : (data[field.key] || '-')
            }</div>
        </div>
    `).join('');
}

// Volna Test
let volnaAutoRefreshInterval = null;
let volnaNextRefreshTime = null;
let volnaCountdownInterval = null;

// Pagination state
let volnaAllProjects = [];
let volnaCurrentPage = 1;
const volnaPageSize = 20;

// Track which URLs are already in queue/job data
let jobUrlsInSystem = {};

async function fetchVolnaJobs(silent = false) {
    const fetchText = document.getElementById('volna-fetch-text');
    const fetchLoading = document.getElementById('volna-fetch-loading');
    const lastFetchEl = document.getElementById('volna-last-fetch');
    const projectCountEl = document.getElementById('volna-project-count');
    
    if (!silent) {
        fetchText.classList.add('hidden');
        fetchLoading.classList.remove('hidden');
    }
    
    try {
        // Fetch both Volna jobs and existing job URLs in parallel
        const [response, urlsResponse] = await Promise.all([
            api('/volna/jobs'),
            api('/jobs/urls')
        ]);
        
        // Store URL map for checking
        jobUrlsInSystem = urlsResponse || {};
        
        // Update timestamp with exact time
        const now = new Date();
        lastFetchEl.textContent = formatTimestamp(now, true);
        projectCountEl.textContent = response ? response.length : 0;
        
        // Store all projects for pagination
        volnaAllProjects = response || [];
        volnaCurrentPage = 1;
        
        // Render with pagination
        renderVolnaProjects();
        
        if (!silent && response && response.length > 0) {
            showToast(`Found ${response.length} projects from Volna`, 'success');
        }
    } catch (error) {
        if (!silent) {
            showToast(error.message || 'Failed to fetch Volna projects', 'error');
        }
        volnaAllProjects = [];
        renderVolnaProjects();
    } finally {
        fetchText.classList.remove('hidden');
        fetchLoading.classList.add('hidden');
    }
}

function renderVolnaProjects() {
    const resultsContainer = document.getElementById('volna-results');
    const paginationContainer = document.getElementById('volna-pagination');
    
    if (!volnaAllProjects || volnaAllProjects.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>No projects found from Volna filter</p>
            </div>
        `;
        paginationContainer.style.display = 'none';
        return;
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(volnaAllProjects.length / volnaPageSize);
    const startIndex = (volnaCurrentPage - 1) * volnaPageSize;
    const endIndex = startIndex + volnaPageSize;
    const pageProjects = volnaAllProjects.slice(startIndex, endIndex);
    
    // Render projects
    resultsContainer.innerHTML = `
        <div class="volna-job-list">
            ${pageProjects.map((project, index) => {
                const isInSystem = jobUrlsInSystem[project.url];
                const statusLabel = isInSystem ? `(${isInSystem})` : '';
                return `
                <div class="volna-job-item ${isInSystem ? 'in-queue' : ''}">
                    <div class="volna-job-number">${startIndex + index + 1}</div>
                    <div class="volna-job-info">
                        <div class="volna-job-title">${project.title || 'Untitled'} ${isInSystem ? `<span class="job-status-tag ${isInSystem}">${statusLabel}</span>` : ''}</div>
                        <div class="volna-job-meta">
                            <span>${project.budget_type || ''} ${project.budget_amount || ''}</span>
                            ${project.client_country ? `<span>📍 ${project.client_country}</span>` : ''}
                            ${project.client_rating ? `<span>⭐ ${project.client_rating}</span>` : ''}
                            ${project.client_verified ? '<span>✓ Verified</span>' : ''}
                        </div>
                        <a href="${project.url}" target="_blank" class="volna-job-url">${project.url}</a>
                        ${project.published_at ? `<div class="volna-job-time">Posted: ${formatTimestamp(new Date(project.published_at))}</div>` : ''}
                    </div>
                    ${isInSystem && isInSystem !== 'processing' ? `
                        <button class="btn btn-danger btn-small" onclick="removeVolnaJobFromQueue('${project.url}')">
                            Remove
                        </button>
                    ` : isInSystem === 'processing' ? `
                        <button class="btn btn-secondary btn-small" disabled>
                            Processing...
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-small" onclick="addVolnaJobToQueue('${project.url}')">
                            Add to Queue
                        </button>
                    `}
                </div>
            `}).join('')}
        </div>
    `;
    
    // Update pagination
    if (totalPages > 1) {
        paginationContainer.style.display = 'flex';
        document.getElementById('volna-current-page').textContent = volnaCurrentPage;
        document.getElementById('volna-total-pages').textContent = totalPages;
        document.getElementById('volna-total-items').textContent = volnaAllProjects.length;
        
        document.getElementById('volna-prev-btn').disabled = volnaCurrentPage === 1;
        document.getElementById('volna-next-btn').disabled = volnaCurrentPage === totalPages;
    } else {
        paginationContainer.style.display = 'none';
    }
}

function volnaChangePage(delta) {
    const totalPages = Math.ceil(volnaAllProjects.length / volnaPageSize);
    const newPage = volnaCurrentPage + delta;
    
    if (newPage >= 1 && newPage <= totalPages) {
        volnaCurrentPage = newPage;
        renderVolnaProjects();
        
        // Scroll to top of results
        document.getElementById('volna-results').scrollIntoView({ behavior: 'smooth' });
    }
}

function formatTimestamp(date, showExactTime = false) {
    // Always show exact time for "Last fetched"
    if (showExactTime) {
        return date.toLocaleTimeString();
    }
    
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
        return 'Just now';
    } else if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        return date.toLocaleString();
    }
}

function toggleVolnaAutoRefresh() {
    const checkbox = document.getElementById('volna-auto-refresh');
    const nextRefreshContainer = document.getElementById('volna-next-refresh-container');
    
    if (checkbox.checked) {
        // Start auto-refresh (every 30 seconds)
        const refreshInterval = 30000; // 30 seconds
        
        // Set next refresh time
        volnaNextRefreshTime = Date.now() + refreshInterval;
        nextRefreshContainer.style.display = 'flex';
        
        // Start countdown
        updateNextRefreshCountdown();
        volnaCountdownInterval = setInterval(updateNextRefreshCountdown, 1000);
        
        // Start auto-refresh
        volnaAutoRefreshInterval = setInterval(() => {
            fetchVolnaJobs(true);
            volnaNextRefreshTime = Date.now() + refreshInterval;
        }, refreshInterval);
        
        showToast('Auto-refresh enabled (every 30s)', 'success');
    } else {
        // Stop auto-refresh
        if (volnaAutoRefreshInterval) {
            clearInterval(volnaAutoRefreshInterval);
            volnaAutoRefreshInterval = null;
        }
        if (volnaCountdownInterval) {
            clearInterval(volnaCountdownInterval);
            volnaCountdownInterval = null;
        }
        nextRefreshContainer.style.display = 'none';
        showToast('Auto-refresh disabled');
    }
}

function updateNextRefreshCountdown() {
    const nextRefreshEl = document.getElementById('volna-next-refresh');
    if (!volnaNextRefreshTime) return;
    
    const remaining = Math.max(0, Math.ceil((volnaNextRefreshTime - Date.now()) / 1000));
    nextRefreshEl.textContent = `${remaining}s`;
}

async function addVolnaJobToQueue(url) {
    try {
        await api('/jobs', {
            method: 'POST',
            body: JSON.stringify({ jobUrl: url })
        });
        // Update local state
        jobUrlsInSystem[url] = 'queued';
        renderVolnaProjects();
        showToast('Job added to queue', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to add job', 'error');
    }
}

async function removeVolnaJobFromQueue(url) {
    try {
        await api('/jobs/by-url', {
            method: 'DELETE',
            body: JSON.stringify({ jobUrl: url })
        });
        // Update local state
        delete jobUrlsInSystem[url];
        renderVolnaProjects();
        showToast('Job removed', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to remove job', 'error');
    }
}

// Settings
async function loadSettings() {
    try {
        const settings = await api('/settings');
        
        settings.forEach(setting => {
            switch (setting.key) {
                case 'maintenance_mode':
                    document.getElementById('maintenance-mode-toggle').checked = setting.value === 'true';
                    break;
                case 'volna_stopped':
                    document.getElementById('volna-stopped-toggle').checked = setting.value === 'true';
                    break;
                case 'upwork_stopped':
                    document.getElementById('upwork-stopped-toggle').checked = setting.value === 'true';
                    break;
                case 'upwork_rate_limit':
                    document.getElementById('upwork-rate-limit').value = setting.value;
                    break;
                case 'min_interval':
                    document.getElementById('min-interval').value = setting.value;
                    break;
                case 'max_interval':
                    document.getElementById('max-interval').value = setting.value;
                    break;
                case 'upwork_client_id':
                    document.getElementById('upwork-client-id').value = setting.value;
                    break;
                case 'upwork_client_secret':
                    document.getElementById('upwork-client-secret').value = setting.value;
                    break;
                case 'upwork_redirect_uri':
                    document.getElementById('upwork-redirect-uri').value = setting.value;
                    break;
                case 'volna_api_key':
                    document.getElementById('volna-api-key').value = setting.value;
                    break;
                case 'volna_filter_id_1':
                    document.getElementById('volna-filter-id-1').value = setting.value;
                    break;
                case 'volna_filter_id_2':
                    document.getElementById('volna-filter-id-2').value = setting.value;
                    break;
                case 'volna_filter_id_3':
                    document.getElementById('volna-filter-id-3').value = setting.value;
                    break;
                case 'volna_filter_id_4':
                    document.getElementById('volna-filter-id-4').value = setting.value;
                    break;
                case 'volna_auto_fetch':
                    document.getElementById('volna-auto-fetch-toggle').checked = setting.value === 'true';
                    break;
                case 'volna_fetch_interval':
                    document.getElementById('volna-fetch-interval').value = setting.value;
                    break;
                case 'volna_auto_add':
                    document.getElementById('volna-auto-add-toggle').checked = setting.value === 'true';
                    break;
                case 'working_hours_enabled':
                    document.getElementById('working-hours-enabled-toggle').checked = setting.value === 'true';
                    break;
                case 'working_hours_start':
                    document.getElementById('working-hours-start').value = setting.value || '09:00';
                    break;
                case 'working_hours_end':
                    document.getElementById('working-hours-end').value = setting.value || '18:00';
                    break;
                case 'working_days':
                    // Parse working days (e.g., "1,2,3,4,5" for Mon-Fri)
                    const days = setting.value ? setting.value.split(',') : ['1','2','3','4','5'];
                    for (let i = 0; i < 7; i++) {
                        document.getElementById(`working-day-${i}`).checked = days.includes(i.toString());
                    }
                    break;
                case 'leadhack_delay_hours':
                    document.getElementById('leadhack-delay-hours').value = setting.value || '2';
                    break;
            }
        });
        
        // Load LeadHack queue status
        await loadLeadhackStatus();
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function loadLeadhackStatus() {
    try {
        const stats = await api('/stats/leadhack');
        
        document.getElementById('leadhack-pending').textContent = stats.pending || 0;
        document.getElementById('leadhack-sent').textContent = stats.sent || 0;
        document.getElementById('leadhack-failed').textContent = stats.failed || 0;
        
        const nextSendRow = document.getElementById('leadhack-next-send-row');
        const nextSendEl = document.getElementById('leadhack-next-send');
        
        if (stats.nextSendAt) {
            const nextDate = new Date(stats.nextSendAt);
            const now = new Date();
            const diffMs = nextDate - now;
            
            if (diffMs > 0) {
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                nextSendEl.textContent = `${nextDate.toLocaleString()} (in ${diffHours}h ${diffMins}m)`;
                nextSendRow.style.display = 'flex';
            } else {
                nextSendEl.textContent = 'Processing soon...';
                nextSendRow.style.display = 'flex';
            }
        } else {
            nextSendRow.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to load LeadHack status:', error);
    }
}

async function toggleMaintenanceMode() {
    const isEnabled = document.getElementById('maintenance-mode-toggle').checked;
    
    try {
        await api('/settings', {
            method: 'POST',
            body: JSON.stringify({
                key: 'maintenance_mode',
                value: isEnabled.toString()
            })
        });
        
        // Update dashboard banner
        const banner = document.getElementById('maintenance-banner');
        if (isEnabled) {
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
        
        showToast(`Maintenance mode ${isEnabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
        showToast('Failed to update maintenance mode', 'error');
        // Revert toggle
        document.getElementById('maintenance-mode-toggle').checked = !isEnabled;
    }
}

async function toggleVolnaStopped() {
    const isStopped = document.getElementById('volna-stopped-toggle').checked;
    
    try {
        await api('/settings', {
            method: 'POST',
            body: JSON.stringify({
                key: 'volna_stopped',
                value: isStopped.toString()
            })
        });
        
        showToast(`Volna data fetching ${isStopped ? 'stopped' : 'resumed'}`, 'success');
    } catch (error) {
        showToast('Failed to update Volna status', 'error');
        document.getElementById('volna-stopped-toggle').checked = !isStopped;
    }
}

async function toggleUpworkStopped() {
    const isStopped = document.getElementById('upwork-stopped-toggle').checked;
    
    try {
        await api('/settings', {
            method: 'POST',
            body: JSON.stringify({
                key: 'upwork_stopped',
                value: isStopped.toString()
            })
        });
        
        showToast(`Upwork processing ${isStopped ? 'stopped' : 'resumed'}`, 'success');
    } catch (error) {
        showToast('Failed to update Upwork status', 'error');
        document.getElementById('upwork-stopped-toggle').checked = !isStopped;
    }
}

async function saveSettings() {
    // Get working days as comma-separated string
    const workingDays = [];
    for (let i = 0; i < 7; i++) {
        if (document.getElementById(`working-day-${i}`).checked) {
            workingDays.push(i.toString());
        }
    }
    
    const settings = [
        { key: 'upwork_rate_limit', value: document.getElementById('upwork-rate-limit').value },
        { key: 'min_interval', value: document.getElementById('min-interval').value },
        { key: 'max_interval', value: document.getElementById('max-interval').value },
        { key: 'upwork_client_id', value: document.getElementById('upwork-client-id').value },
        { key: 'upwork_client_secret', value: document.getElementById('upwork-client-secret').value },
        { key: 'upwork_redirect_uri', value: document.getElementById('upwork-redirect-uri').value },
        { key: 'volna_api_key', value: document.getElementById('volna-api-key').value },
        { key: 'volna_filter_id_1', value: document.getElementById('volna-filter-id-1').value },
        { key: 'volna_filter_id_2', value: document.getElementById('volna-filter-id-2').value },
        { key: 'volna_filter_id_3', value: document.getElementById('volna-filter-id-3').value },
        { key: 'volna_filter_id_4', value: document.getElementById('volna-filter-id-4').value },
        { key: 'volna_auto_fetch', value: document.getElementById('volna-auto-fetch-toggle').checked.toString() },
        { key: 'volna_fetch_interval', value: document.getElementById('volna-fetch-interval').value },
        { key: 'volna_auto_add', value: document.getElementById('volna-auto-add-toggle').checked.toString() },
        { key: 'working_hours_enabled', value: document.getElementById('working-hours-enabled-toggle').checked.toString() },
        { key: 'working_hours_start', value: document.getElementById('working-hours-start').value },
        { key: 'working_hours_end', value: document.getElementById('working-hours-end').value },
        { key: 'working_days', value: workingDays.join(',') },
        { key: 'leadhack_delay_hours', value: document.getElementById('leadhack-delay-hours').value }
    ];
    
    try {
        await api('/settings/bulk', {
            method: 'POST',
            body: JSON.stringify({ settings })
        });
        
        showToast('Settings saved successfully', 'success');
    } catch (error) {
        showToast('Failed to save settings', 'error');
    }
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    toast.className = 'toast';
    toast.classList.add(type);
    toastMessage.textContent = message;
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Upwork Connection
async function checkUpworkStatus() {
    try {
        const status = await api('/upwork/status');
        const statusEl = document.getElementById('upwork-connection-status');
        const connectBtn = document.getElementById('upwork-connect-btn');
        const disconnectBtn = document.getElementById('upwork-disconnect-btn');
        
        if (status.connected) {
            statusEl.textContent = 'Connected';
            statusEl.style.color = '#10b981';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'inline-block';
        } else {
            statusEl.textContent = 'Not connected';
            statusEl.style.color = '#6b7280';
            connectBtn.style.display = 'inline-block';
            disconnectBtn.style.display = 'none';
        }
    } catch (error) {
        document.getElementById('upwork-connection-status').textContent = 'Status unknown';
    }
}

async function connectUpwork() {
    try {
        // First save settings in case they were just entered
        await saveSettings();
        
        const data = await api('/upwork/login');
        if (data.authUrl) {
            window.location.href = data.authUrl;
        } else if (data.error) {
            showToast(data.error, 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to connect to Upwork', 'error');
    }
}

async function disconnectUpwork() {
    if (!confirm('Are you sure you want to disconnect from Upwork?')) return;
    
    try {
        await api('/upwork/disconnect', { method: 'POST' });
        showToast('Disconnected from Upwork', 'success');
        checkUpworkStatus();
    } catch (error) {
        showToast('Failed to disconnect', 'error');
    }
}

// Test Volna Connection
async function testVolnaConnection() {
    const statusEl = document.getElementById('volna-connection-status');
    statusEl.textContent = 'Testing...';
    statusEl.style.color = 'var(--gray-600)';
    
    try {
        // First save settings to make sure we test with current values
        await saveSettings();
        
        const result = await api('/volna/test');
        
        if (result.connected) {
            statusEl.textContent = `✓ Connected! ${result.total_projects} projects found in filter(s): ${result.filters.join(', ')}`;
            statusEl.style.color = '#10b981';
            showToast('Volna connection successful!', 'success');
        } else {
            statusEl.textContent = `✗ ${result.message}`;
            statusEl.style.color = '#ef4444';
            showToast(result.message, 'error');
        }
    } catch (error) {
        statusEl.textContent = `✗ Error: ${error.message}`;
        statusEl.style.color = '#ef4444';
        showToast('Failed to test Volna connection', 'error');
    }
}

// Auto-refresh dashboard every 30 seconds
setInterval(() => {
    const activePage = document.querySelector('.page:not(.hidden)');
    if (activePage && activePage.id === 'page-dashboard') {
        loadDashboard();
    }
}, 30000);
