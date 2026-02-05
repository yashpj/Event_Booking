import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const Dashboard = () => {
    const [data, setData] = useState(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await axios.get('/admin/stats');
                setData(res.data);
            } catch (err) { console.error(err); }
        };
        fetchStats();
    }, []);

    if (!data) return <div>Loading Analytics...</div>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Admin Analytics</h2>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
                <div className="card"><h3>${data.revenue}</h3><p>Total Revenue</p></div>
                <div className="card"><h3>{data.tickets_sold}</h3><p>Tickets Sold</p></div>
            </div>

            <h3>Event Occupancy</h3>
            <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                    <BarChart data={data.chart_data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="sold" fill="#8884d8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default Dashboard;